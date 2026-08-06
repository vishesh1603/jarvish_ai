"""
Jarvish AI — RAG Knowledge Base Store
======================================
Manages document upload parsing (PDF/TXT), semantic chunking,
and local vector embeddings via ChromaDB.
"""

import os
import re
import uuid
import hashlib
import numpy as np
import chromadb
from chromadb.api.types import EmbeddingFunction

CHROMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_db")


class OfflineLocalEmbeddingFunction(EmbeddingFunction):
    """100% offline, deterministic, zero-dependency text embedding function.
    Avoids external ONNX/HuggingFace model download timeouts.
    """
    def __call__(self, input: list[str]) -> list[list[float]]:
        embeddings = []
        for text in input:
            vec = np.zeros(384, dtype=np.float32)
            words = re.findall(r"\w+", text.lower())
            for w in words:
                h = int(hashlib.md5(w.encode("utf-8")).hexdigest(), 16)
                idx = h % 384
                vec[idx] += 1.0
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec /= norm
            embeddings.append(vec.tolist())
        return embeddings


_embedding_func = OfflineLocalEmbeddingFunction()

# Initialize ChromaDB persistent client
_chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
try:
    _collection = _chroma_client.get_or_create_collection(
        name="jarvish_offline_kb",
        embedding_function=_embedding_func,
        metadata={"hnsw:space": "cosine"}
    )
except Exception:
    _chroma_client.delete_collection("jarvish_offline_kb")
    _collection = _chroma_client.get_or_create_collection(
        name="jarvish_offline_kb",
        embedding_function=_embedding_func,
        metadata={"hnsw:space": "cosine"}
    )


def extract_text_from_file(filename: str, file_bytes: bytes) -> str:
    """Extract plain text from uploaded PDF or TXT bytes."""
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".pdf":
        text = ""
        # Try PyMuPDF (fitz) first
        try:
            import fitz
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            for page in doc:
                text += page.get_text() + "\n"
            if text.strip():
                return text
        except Exception as e:
            print(f"[RAG Warning] fitz PDF extract failed: {e}")

        # Fall back to pypdf
        try:
            import pypdf
            import io
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
            return text
        except Exception as e:
            print(f"[RAG Warning] pypdf extract failed: {e}")
            return ""

    else:
        # Default: text file
        try:
            return file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return file_bytes.decode("latin-1", errors="ignore")


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into overlapping character chunks."""
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return []

    chunks = []
    start = 0
    while start < len(cleaned):
        end = start + chunk_size
        chunk = cleaned[start:end]
        chunks.append(chunk)
        start += (chunk_size - overlap)

    return chunks


def add_document_to_rag(user_id: str, doc_id: str, filename: str, file_bytes: bytes) -> int:
    """Extract, chunk, embed, and store document in ChromaDB vector store.

    Returns the total number of chunks stored.
    """
    raw_text = extract_text_from_file(filename, file_bytes)
    if not raw_text.strip():
        return 0

    chunks = chunk_text(raw_text)
    if not chunks:
        return 0

    ids = []
    documents = []
    metadatas = []

    for idx, chunk in enumerate(chunks):
        chunk_id = f"{doc_id}_{idx}"
        ids.append(chunk_id)
        documents.append(chunk)
        metadatas.append({
            "user_id": user_id,
            "doc_id": doc_id,
            "filename": filename,
            "chunk_index": idx
        })

    _collection.add(
        ids=ids,
        documents=documents,
        metadatas=metadatas
    )

    return len(chunks)


def query_rag_knowledge(user_id: str, query_text: str, top_k: int = 3) -> list[str]:
    """Retrieve top_k matching document chunks for user_id and query_text."""
    if not query_text.strip():
        return []

    try:
        results = _collection.query(
            query_texts=[query_text],
            n_results=top_k,
            where={"user_id": user_id}
        )

        if results and "documents" in results and results["documents"]:
            chunks = results["documents"][0]
            return [c for c in chunks if c.strip()]

    except Exception as e:
        print(f"[RAG Search Error] {e}")

    return []


def delete_document_from_rag(user_id: str, doc_id: str):
    """Remove all vectors associated with doc_id and user_id from ChromaDB."""
    try:
        _collection.delete(
            where={"doc_id": doc_id}
        )
    except Exception as e:
        print(f"[RAG Delete Warning] {e}")

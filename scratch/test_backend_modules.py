import os
import database
import auth
import rag_store

# 1. Test Database & Models
print("=== 1. Testing Database & Models ===")
database.init_db()
db = database.SessionLocal()

# Cleanup old test user if exists
existing = db.query(database.User).filter(database.User.email == "test@jarvish.ai").first()
if existing:
    db.delete(existing)
    db.commit()

user = database.User(
    email="test@jarvish.ai",
    password_hash=auth.hash_password("secret123")
)
db.add(user)
db.commit()
db.refresh(user)

print("Created User ID:", user.id)
print("Password check (correct):", auth.verify_password("secret123", user.password_hash))
print("Password check (incorrect):", auth.verify_password("wrongpass", user.password_hash))

# 2. Test JWT Authentication
print("\n=== 2. Testing JWT Auth ===")
token = auth.create_access_token(user.id, user.email)
print("Generated Token:", token[:25] + "...")
decoded = auth.decode_token(token)
print("Decoded Token Sub:", decoded["sub"])
assert decoded["sub"] == user.id

# 3. Test Conversation & Message DB Storage
print("\n=== 3. Testing Conversation DB Storage ===")
conv = database.Conversation(user_id=user.id, title="Quantum Physics Basics")
db.add(conv)
db.commit()
db.refresh(conv)

msg1 = database.Message(conversation_id=conv.id, role="user", text="What is superposition?")
msg2 = database.Message(conversation_id=conv.id, role="model", text="Superposition means a system exists in multiple states at once until measured.")
db.add_all([msg1, msg2])
db.commit()

# Verify relation query
loaded_conv = db.query(database.Conversation).filter(database.Conversation.id == conv.id).first()
print("Loaded Conversation Title:", loaded_conv.title)
print("Message Count:", len(loaded_conv.messages))
for m in loaded_conv.messages:
    print(f"  [{m.role}]: {m.text}")

# 4. Test RAG Vector Store
print("\n=== 4. Testing RAG Vector Store ===")
doc_text = """
Quantum entanglement is a phenomenon where physical particles remain connected so that actions performed on one affect the other, even when separated by huge distances.
Albert Einstein famously referred to this as 'spooky action at a distance'.
Jarvish AI Knowledge Base Special Note: The secret key for Project Nebula is NEBULA-9988-X.
"""
doc_bytes = doc_text.encode("utf-8")
chunk_count = rag_store.add_document_to_rag(user.id, "doc_test_1", "notes.txt", doc_bytes)
print(f"Indexed document into RAG: {chunk_count} chunks")

# Query RAG
results = rag_store.query_rag_knowledge(user.id, "What is Project Nebula secret key?")
print("RAG Query Results:")
for r in results:
    print("  ->", r)

db.close()
print("\n=== Backend Modules Test Passed Cleanly! ===")

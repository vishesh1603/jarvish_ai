import requests
import json
import time

BASE_URL = "http://127.0.0.1:5000"

print("==================================================")
print("  Jarvish AI — End-to-End Integration Verification")
print("==================================================")

# ---------------------------------------------------------------------------
# Priority 1: Authentication (Signup, Login, JWT verification)
# ---------------------------------------------------------------------------
print("\n--- Testing Priority 1: Basic Authentication ---")
signup_email = f"student_rag_{int(time.time())}@learnzo.in"
signup_pass = "securepass123"

# 1. Signup
resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
    "email": signup_email,
    "password": signup_pass
})
print("1. Signup Status:", resp.status_code)
assert resp.status_code == 200
signup_data = resp.json()
token = signup_data["access_token"]
user_id = signup_data["user"]["id"]
print(f"   User Created: {signup_email} (ID: {user_id[:8]}...)")

# 2. Login
resp = requests.post(f"{BASE_URL}/api/auth/login", json={
    "email": signup_email,
    "password": signup_pass
})
print("2. Login Status:", resp.status_code)
assert resp.status_code == 200
token = resp.json()["access_token"]

# 3. Invalid Login Rejection
resp = requests.post(f"{BASE_URL}/api/auth/login", json={
    "email": signup_email,
    "password": "wrongpassword"
})
print("3. Invalid Password Rejection Status:", resp.status_code, "(Expected 401)")
assert resp.status_code == 401

# 4. GET /api/auth/me with Bearer Token
headers = {"Authorization": f"Bearer {token}"}
resp = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
print("4. GET /api/auth/me Status:", resp.status_code, "User:", resp.json()["email"])
assert resp.status_code == 200

# ---------------------------------------------------------------------------
# Priority 2: Persistent SQLite Database (Conversations & User Scoping)
# ---------------------------------------------------------------------------
print("\n--- Testing Priority 2: Persistent Database ---")

# 1. Chat turn with JWT
resp = requests.post(f"{BASE_URL}/api/chat", json={"message": "Explain black holes in one sentence."}, headers=headers)
print("1. Chat Turn Status:", resp.status_code)
assert resp.status_code == 200
chat_data = resp.json()
conv_id = chat_data["conversation_id"]
print(f"   Bot Reply: {chat_data['reply'][:60]}...")
print(f"   Conversation ID: {conv_id}")

# 2. List Conversations (DB backed)
resp = requests.get(f"{BASE_URL}/api/conversations", headers=headers)
print("2. List Conversations Status:", resp.status_code, f"Count: {len(resp.json())}")
assert resp.status_code == 200
assert len(resp.json()) >= 1

# 3. Get Full Conversation Details
resp = requests.get(f"{BASE_URL}/api/conversations/{conv_id}", headers=headers)
print("3. Get Conversation Details Status:", resp.status_code, "Messages:", len(resp.json()["messages"]))
assert resp.status_code == 200
assert len(resp.json()["messages"]) == 2

# ---------------------------------------------------------------------------
# Priority 3: RAG Knowledge Base (Document Upload & Vector Search)
# ---------------------------------------------------------------------------
print("\n--- Testing Priority 3: RAG Knowledge Base ---")

# 1. Upload Document
doc_content = """
Learnzo Bharat Special Syllabus 2026:
Chapter 7 Quantum Thermodynamics: The secret validation passcode is SUPERCONDUCTOR-8821-X.
Students must submit their assignments before midnight on Friday.
"""

files = {
    "file": ("quantum_syllabus.txt", doc_content.encode("utf-8"), "text/plain")
}
resp = requests.post(f"{BASE_URL}/api/documents/upload", files=files, headers=headers)
print("1. Document Upload Status:", resp.status_code)
assert resp.status_code == 200
doc_data = resp.json()
doc_id = doc_data["doc_id"]
print(f"   Uploaded '{doc_data['filename']}' ({doc_data['chunk_count']} vector chunks)")

# 2. List Documents
resp = requests.get(f"{BASE_URL}/api/documents", headers=headers)
print("2. List Documents Status:", resp.status_code, "Doc Count:", len(resp.json()))
assert resp.status_code == 200
assert len(resp.json()) >= 1

# 3. RAG Context Chat Question
chat_payload = {
    "message": "What is the secret validation passcode for Chapter 7 Quantum Thermodynamics in the syllabus?",
    "conversation_id": conv_id
}
resp = requests.post(f"{BASE_URL}/api/chat", json=chat_payload, headers=headers)
print("3. RAG Chat Query Status:", resp.status_code)
assert resp.status_code == 200
rag_chat = resp.json()
print("   RAG Vector Search Used:", rag_chat["rag_used"])
print(f"   RAG AI Answer: {rag_chat['reply']}")
assert rag_chat["rag_used"] == True

# 4. Clean Up Uploaded Document
resp = requests.delete(f"{BASE_URL}/api/documents/{doc_id}", headers=headers)
print("4. Delete Document Status:", resp.status_code)
assert resp.status_code == 200

print("==================================================")
print("  ALL PRIORITIES (AUTH, DB, RAG) VERIFIED E2E! SUCCESS!")
print("==================================================")

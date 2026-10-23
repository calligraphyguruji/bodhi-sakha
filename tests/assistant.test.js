import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.ALLOW_LOCAL_DB = 'true';
process.env.JWT_SECRET = 'unit-test-secret-which-is-at-least-32-characters';
delete process.env.DATABASE_URL;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bodhi-tests-'));
process.env.LOCAL_DATA_DIR = testDir;
const { db } = await import('../server/endpoints/lib/db.js');
test.after(() => fs.rmSync(testDir,{recursive:true,force:true}));
import { hashPassword, comparePassword, signToken, verifyToken } from '../server/endpoints/lib/auth.js';
import { formatMemoriesForPrompt } from '../server/endpoints/lib/memory.js';

test('Security & Persistence Suite', async (t) => {
  await t.test('Password hashing and verification', async () => {
    const raw = 'SuperSecret123!';
    const hashed = await hashPassword(raw);
    assert.notEqual(hashed, raw);
    const valid = await comparePassword(raw, hashed);
    assert.equal(valid, true);
    const invalid = await comparePassword('wrong', hashed);
    assert.equal(invalid, false);
  });

  await t.test('JWT token generation and verification', () => {
    const userPayload = { id: 'usr_abc123', email: 'test@domain.com', name: 'Tester' };
    const token = signToken(userPayload);
    assert.ok(token);
    const verified = verifyToken(token);
    assert.equal(verified.id, userPayload.id);
    assert.equal(verified.email, userPayload.email);
    assert.equal(verifyToken('invalid.token.here'), null);
  });

  await t.test('Multi-user data isolation (IDOR protection)', async () => {
    const userA = 'usr_isolate_a';
    const userB = 'usr_isolate_b';

    // Create user A conversation
    const convA = await db.createConversation({ id: 'conv_a1', user_id: userA, title: 'User A Secret Chat' });
    assert.equal(convA.id, 'conv_a1');

    // User A can access
    const foundA = await db.getConversation('conv_a1', userA);
    assert.ok(foundA);
    assert.equal(foundA.title, 'User A Secret Chat');

    // User B CANNOT access User A's conversation
    const foundB = await db.getConversation('conv_a1', userB);
    assert.equal(foundB, null);

    // User B conversations list does not include User A's chat
    const listB = await db.getConversations(userB);
    assert.equal(listB.some(c => c.id === 'conv_a1'), false);

    // User A memories isolated from User B
    await db.setMemory({ id: 'mem_a1', user_id: userA, memory_key: 'hobby', memory_value: 'Calligraphy' });
    const memsB = await db.getUserMemory(userB);
    assert.equal(memsB.some(m => m.memory_key === 'hobby'), false);

    // Clean up
    await db.deleteConversation('conv_a1', userA);
    await db.deleteMemory('mem_a1', userA);
  });

  await t.test('Long-term memory prompt formatting', () => {
    const memories = [
      { memory_key: 'name', memory_value: 'Aman' },
      { memory_key: 'learning', memory_value: 'C++' }
    ];
    const formatted = formatMemoriesForPrompt(memories);
    assert.match(formatted, /\[USER LONG-TERM MEMORY & PREFERENCES\]/);
    assert.match(formatted, /name: Aman/);
    assert.match(formatted, /learning: C\+\+/);
  });

  await t.test('File metadata isolation', async () => {
    const userA = 'usr_file_a';
    const userB = 'usr_file_b';

    const file = await db.createUploadedFile({
      id: 'file_a1',
      user_id: userA,
      conversation_id: 'conv_a1',
      file_name: 'test.pdf',
      file_type: 'application/pdf',
      file_size: 1024,
      extracted_text: 'Document contents'
    });
    assert.equal(file.id, 'file_a1');

    const filesB = await db.getConversationFiles('conv_a1', userB);
    assert.equal(filesB.length, 0);

    await db.deleteFile('file_a1', userA);
  });
});

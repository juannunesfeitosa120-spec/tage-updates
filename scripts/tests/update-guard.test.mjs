import assert from 'node:assert/strict';
import test from 'node:test';
import { installUpdateGuard } from '../../desktop/update-guard.mjs';

function fixture(t) {
  let clock = 0;
  let writes = 0;
  let resolver;
  const listeners = new Map();
  const root = { inert: false };
  const dialogs = [];
  const target = {
    document: {
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name) { listeners.delete(name); },
      getElementById() { return root; },
      querySelectorAll() { return dialogs; },
    },
    fetch: async () => { writes += 1; return await new Promise((resolve) => { resolver = resolve; }); },
  };
  const guard = installUpdateGuard(target, () => clock);
  t.after(() => guard.dispose());
  return {
    guard, root, target, dialogs, listeners,
    advance(ms = 31_000) { clock += ms; },
    interact(control) { listeners.get('focusin')({ target: { closest: () => control } }); },
    resolve() { resolver({ ok: true }); },
    get writes() { return writes; },
  };
}

void test('espera inatividade, protege rascunho e libera após limpar', (t) => {
  const f = fixture(t);
  assert.equal(f.guard.prepare(), false);
  const field = { value: '', type: 'text', isConnected: true };
  f.interact(field);
  field.value = 'mensagem ainda não enviada';
  f.advance();
  assert.equal(f.guard.prepare(), false);
  field.value = '';
  assert.equal(f.guard.prepare(), true);
  assert.equal(f.root.inert, true);
  f.guard.cancel();
  assert.equal(f.root.inert, false);
});

void test('aguarda envio pendente sem exigir mais trinta segundos após cada heartbeat', async (t) => {
  const f = fixture(t);
  f.advance();
  const pending = f.target.fetch('/rest/v1/contagens', { method: 'POST' });
  assert.equal(f.guard.prepare(), false);
  f.resolve();
  await pending;
  assert.equal(f.guard.prepare(), false);
  f.advance(2000);
  assert.equal(f.guard.prepare(), true);
});

void test('bloqueia novas gravações entre o backup e o reinício', async (t) => {
  const f = fixture(t);
  f.advance();
  assert.equal(f.guard.prepare(), true);
  await assert.rejects(f.target.fetch('/upload', { method: 'POST' }), { name: 'AbortError' });
  assert.equal(f.writes, 0);
  const read = f.target.fetch('/rest/v1/itens');
  f.resolve();
  await read;
  assert.equal(f.writes, 1);
});

void test('modal aberto, rascunho de outra aba, arquivo e alterações numéricas impedem reinício', (t) => {
  const f = fixture(t);
  const quantity = { value: '0', type: 'number', isConnected: true };
  f.interact(quantity);
  quantity.value = '42';
  f.advance();
  assert.equal(f.guard.prepare(), false);
  quantity.value = '0';
  const file = { type: 'file', files: [], isConnected: true };
  f.interact(file);
  file.files = [{}];
  f.advance();
  assert.equal(f.guard.prepare(), false);
  file.files = [];
  f.dialogs.push({ getClientRects: () => [{}] });
  assert.equal(f.guard.prepare(), false);
  f.dialogs.length = 0;
  assert.equal(f.guard.prepare(), true);
});

void test('nova interação reinicia espera e dispose restaura controles', (t) => {
  const f = fixture(t);
  f.advance();
  f.interact(null);
  assert.equal(f.guard.prepare(), false);
  f.advance();
  assert.equal(f.guard.prepare(), true);
  f.guard.dispose();
  assert.equal(f.root.inert, false);
  assert.equal(f.listeners.size, 0);
});

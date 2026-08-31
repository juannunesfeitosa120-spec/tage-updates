import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareVersions,
  nextBetaVersion,
  nextStableVersion,
  promoteBetaVersion,
  resolveRepository,
  validateReleaseNotes,
} from '../lib/release-core.mjs';

void test('incrementa versões Stable sem carregar pre-release', () => {
  assert.equal(nextStableVersion('1.4.2', 'patch'), '1.4.3');
  assert.equal(nextStableVersion('1.4.2', 'minor'), '1.5.0');
  assert.equal(nextStableVersion('1.4.2', 'major'), '2.0.0');
});

void test('cria e incrementa Beta da próxima versão minor', () => {
  assert.equal(nextBetaVersion('1.4.2'), '1.5.0-beta.1');
  assert.equal(
    nextBetaVersion('1.4.2', '1.5.0-beta.2'),
    '1.5.0-beta.3',
  );
});

void test('promove Beta retirando somente o identificador de pre-release', () => {
  assert.equal(promoteBetaVersion('1.5.0-beta.3'), '1.5.0');
});

void test('ordena pre-release antes da Stable correspondente', () => {
  assert.equal(compareVersions('1.5.0-beta.3', '1.5.0'), -1);
  assert.equal(compareVersions('1.5.1', '1.5.0'), 1);
});

void test('valida notas legíveis e completas', () => {
  const notes = '# Tage\n\n## Novidades\n\n- Novo fluxo.\n\n## Correções\n\n- Mais estabilidade.';
  assert.equal(validateReleaseNotes(notes), null);
  assert.match(validateReleaseNotes('# Tage\n\nPreencha') ?? '', /Novidades/);
});

void test('resolve repositório por variáveis explícitas ou GitHub Actions', () => {
  assert.deepEqual(
    resolveRepository({
      TAGGI_GITHUB_OWNER: 'taggi',
      TAGGI_GITHUB_REPO: 'releases',
    }),
    { owner: 'taggi', repo: 'releases' },
  );
  assert.deepEqual(
    resolveRepository({ GITHUB_REPOSITORY: 'taggi/releases' }),
    { owner: 'taggi', repo: 'releases' },
  );
});

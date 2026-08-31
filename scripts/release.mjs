import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  nextBetaVersion,
  nextStableVersion,
  parseVersion,
  promoteBetaVersion,
  resolveRepository,
  validateReleaseNotes,
} from './lib/release-core.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(projectRoot, 'package.json');
const stateDirectory = path.join(projectRoot, '.taggi');
const releaseStatePath = path.join(stateDirectory, 'release-state.json');
const notesDraftPath = path.join(projectRoot, 'RELEASE_NOTES.md');
const action = process.argv[2] ?? 'status';
const positional = process.argv.slice(3).filter((value) => value !== '--');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readPackage() {
  return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}

function writePackage(metadata) {
  fs.writeFileSync(packagePath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
}

function saveState(value) {
  fs.mkdirSync(stateDirectory, { recursive: true });
  fs.writeFileSync(releaseStatePath, JSON.stringify(value, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...options.env },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: options.shell ?? false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? (result.stderr || result.stdout || '').trim()
      : '';
    throw new Error(
      `${command} ${args.join(' ')} falhou${detail ? `: ${detail}` : '.'}`,
    );
  }
  return options.capture ? result.stdout.trim() : '';
}

function runPackageManager(args) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args]);
  }
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    shell: process.platform === 'win32',
  });
}

function getCommit() {
  return run('git', ['rev-parse', 'HEAD'], { capture: true });
}

function requireCleanWorktree() {
  const status = run('git', ['status', '--porcelain'], { capture: true });
  if (status) {
    throw new Error(
      'A publicação foi interrompida porque existem alterações sem commit. Revise e registre o código antes de publicar.',
    );
  }
}

function hasSigningConfiguration() {
  return Boolean(
    process.env.WIN_CSC_LINK ||
      process.env.CSC_LINK ||
      process.env.TAGGI_CERTIFICATE_SUBJECT_NAME,
  );
}

function requirePublicationEnvironment(channel, { requireSigning = true } = {}) {
  const repository = resolveRepository(process.env);
  if (!repository) {
    throw new Error(
      'Configure TAGGI_GITHUB_OWNER e TAGGI_GITHUB_REPO para o repositório público de atualizações.',
    );
  }
  if (!(process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) {
    throw new Error('Configure GH_TOKEN ou GITHUB_TOKEN somente no ambiente de release/CI.');
  }
  if (
    !process.env.TAGGI_SUPABASE_URL ||
    !process.env.TAGGI_SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      'Configure TAGGI_SUPABASE_URL e TAGGI_SUPABASE_SERVICE_ROLE_KEY somente no ambiente de release/CI.',
    );
  }
  if (
    requireSigning &&
    !hasSigningConfiguration() &&
    !(channel === 'beta' && process.env.TAGGI_ALLOW_UNSIGNED_BETA === '1')
  ) {
    throw new Error(
      channel === 'stable'
        ? 'Stable exige certificado de assinatura do Windows.'
        : 'Beta exige certificado; para homologação controlada sem certificado, defina explicitamente TAGGI_ALLOW_UNSIGNED_BETA=1.',
    );
  }
  return repository;
}

function verifyUpdaterArtifacts(outputDirectory, channel, requireSignature) {
  const absoluteOutput = path.join(projectRoot, outputDirectory);
  const files = fs.readdirSync(absoluteOutput);
  const installerName = files.find(
    (name) => name.endsWith('.exe') && !name.includes('__uninstaller'),
  );
  const metadataName = files.find(
    (name) =>
      name.endsWith('.yml') &&
      name !== 'builder-debug.yml' &&
      name !== 'builder-effective-config.yaml',
  );
  if (!installerName || !metadataName) {
    throw new Error('O preflight não gerou instalador e metadados do updater.');
  }
  const installerPath = path.join(absoluteOutput, installerName);
  if (!fs.existsSync(installerPath + '.blockmap')) {
    throw new Error('O blockmap diferencial do updater não foi gerado.');
  }

  const updateMetadata = fs.readFileSync(
    path.join(absoluteOutput, metadataName),
    'utf8',
  );
  const checksum = updateMetadata.match(/sha512:\s*['"]?([^'"\s]+)['"]?/i)?.[1];
  if (!checksum) throw new Error('Os metadados não contêm checksum SHA-512.');
  const actualChecksum = crypto
    .createHash('sha512')
    .update(fs.readFileSync(installerPath))
    .digest('base64');
  if (checksum !== actualChecksum) {
    throw new Error('O checksum dos metadados não corresponde ao instalador.');
  }

  let signatureStatus = 'NotChecked';
  if (process.platform === 'win32') {
    const signature = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '& { param([string]$File) (Get-AuthenticodeSignature -LiteralPath $File).Status }',
        installerPath,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    signatureStatus = signature.status === 0 ? signature.stdout.trim() : 'Unknown';
  }
  if (requireSignature && signatureStatus !== 'Valid') {
    throw new Error(
      `A assinatura Authenticode do preflight não é válida (${signatureStatus}).`,
    );
  }
  return {
    installerPath,
    metadataName,
    signatureStatus,
    channel,
  };
}

async function confirmExact(message, token) {
  console.log(message);
  if (process.env.TAGGI_RELEASE_CONFIRMED === token) return;
  if (!process.stdin.isTTY) {
    throw new Error(
      `Confirmação ausente. Defina TAGGI_RELEASE_CONFIRMED=${token} no job protegido.`,
    );
  }
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = (await terminal.question(`Digite ${token} para confirmar: `)).trim();
  terminal.close();
  if (answer !== token) throw new Error('Operação cancelada.');
}

function runValidation() {
  console.log('\nTAGE — VALIDAÇÃO');
  runPackageManager(['run', 'lint:release']);
  runPackageManager(['run', 'test:release']);
  runPackageManager(['run', 'typecheck']);
  runPackageManager(['run', 'desktop:build']);
}

function prepareReleaseNotes(targetVersion) {
  const content = fs.readFileSync(notesDraftPath, 'utf8');
  const notesError = validateReleaseNotes(content);
  if (notesError) throw new Error(`RELEASE_NOTES.md: ${notesError}`);
  const versionedContent = content.replace(/^#\s+Tage.*$/m, `# Tage ${targetVersion}`);
  const notesDirectory = path.join(projectRoot, 'release-notes');
  const notesPath = path.join(notesDirectory, targetVersion + '.md');
  fs.mkdirSync(notesDirectory, { recursive: true });
  fs.writeFileSync(notesPath, versionedContent, 'utf8');
  return { notesPath, content: versionedContent };
}

async function supabaseRequest(resourcePath, options = {}) {
  const baseUrl = process.env.TAGGI_SUPABASE_URL.replace(/\/$/, '');
  const response = await fetch(baseUrl + '/rest/v1/' + resourcePath, {
    ...options,
    headers: {
      apikey: process.env.TAGGI_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.TAGGI_SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Supabase recusou a atualização do catálogo de releases (${response.status}).`,
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function syncReleaseCatalog(release, status) {
  await supabaseRequest('taggi_app_releases?on_conflict=version', {
    method: 'POST',
    body: JSON.stringify([
      {
        version: release.version,
        build_number: release.buildNumber,
        channel: release.channel,
        status,
        rollout_percentage: release.rolloutPercentage,
        minimum_supported_version: release.minimumSupportedVersion,
        release_notes: release.notes,
        source_commit: release.sourceCommit,
        published_at: status === 'DRAFT' ? null : new Date().toISOString(),
      },
    ]),
  });

  const policyPatch =
    release.channel === 'stable'
      ? {
          latest_version: release.version,
          stable_version: release.version,
          minimum_supported_version: release.minimumSupportedVersion,
          default_rollout_percentage: release.rolloutPercentage,
        }
      : {
          latest_version: release.version,
          beta_version: release.version,
          default_rollout_percentage: release.rolloutPercentage,
        };
  await supabaseRequest('taggi_release_policy?id=eq.true', {
    method: 'PATCH',
    body: JSON.stringify(policyPatch),
  });
}

function buildInstaller({
  version,
  buildNumber,
  channel,
  outputDirectory,
  publish,
  repository,
  notesPath,
}) {
  const originalText = fs.readFileSync(packagePath, 'utf8');
  const metadata = JSON.parse(originalText);
  metadata.version = version;
  metadata.buildNumber = buildNumber;
  metadata.taggiReleaseChannel = channel;
  writePackage(metadata);

  const args = [
    'exec',
    'electron-builder',
    '--win',
    'nsis',
    '--x64',
    '--publish',
    publish ? 'always' : 'never',
    `--config.directories.output=${outputDirectory}`,
  ];

  if (channel === 'local') {
    args.push('--config.win.artifactName=Tage-Beta-Test-${version}.${ext}');
  }
  if (repository) {
    args.push(
      '--config.publish.provider=github',
      `--config.publish.owner=${repository.owner}`,
      `--config.publish.repo=${repository.repo}`,
      `--config.publish.channel=${channel === 'beta' ? 'beta' : 'latest'}`,
      `--config.publish.releaseType=${channel === 'beta' ? 'prerelease' : 'release'}`,
    );
  }
  if (notesPath) {
    args.push(`--config.releaseInfo.releaseNotesFile=${notesPath}`);
  }
  if (channel === 'stable') args.push('--config.forceCodeSigning=true');
  if (process.env.TAGGI_CERTIFICATE_SUBJECT_NAME) {
    args.push(
      `--config.win.certificateSubjectName=${process.env.TAGGI_CERTIFICATE_SUBJECT_NAME}`,
    );
  }

  try {
    runPackageManager(args);
  } finally {
    fs.writeFileSync(packagePath, originalText, 'utf8');
  }
}

function printStatus() {
  const metadata = readPackage();
  const releaseState = readJson(releaseStatePath);
  const repository = resolveRepository(process.env);
  console.log('========================================');
  console.log('TAGE — STATUS DE RELEASE');
  console.log('========================================');
  console.log(`Versão no projeto: ${metadata.version}`);
  console.log(`Build no projeto: ${metadata.buildNumber ?? 1}`);
  console.log(`Última Beta local: ${releaseState?.lastBeta?.version ?? 'nenhuma'}`);
  console.log(`Repositório de updates: ${repository ? `${repository.owner}/${repository.repo}` : 'pendente'}`);
  console.log(`Assinatura: ${hasSigningConfiguration() ? 'configurada no ambiente' : 'aguardando certificado'}`);
  console.log(
    `Supabase administrativo: ${
      process.env.TAGGI_SUPABASE_URL &&
      process.env.TAGGI_SUPABASE_SERVICE_ROLE_KEY
        ? 'configurado no ambiente'
        : 'pendente'
    }`,
  );
}

async function buildTest() {
  const metadata = readPackage();
  console.log('========================================');
  console.log('TAGE — BUILD DE TESTE');
  console.log('NÃO PUBLICADA');
  console.log('========================================');
  runValidation();
  buildInstaller({
    version: metadata.version,
    buildNumber: Number(metadata.buildNumber) || 1,
    channel: 'local',
    outputDirectory: 'release/test',
    publish: false,
  });
  console.log('\nBUILD DE TESTE CONCLUÍDA — NÃO PUBLICADA');
}

async function dryRun() {
  console.log('========================================');
  console.log('TAGE — PRÉVIA DE RELEASE');
  console.log('NENHUMA PUBLICAÇÃO SERÁ REALIZADA');
  console.log('========================================');
  runValidation();
  printStatus();
}

async function publishRelease(releaseAction) {
  requireCleanWorktree();
  const metadata = readPackage();
  const state = readJson(releaseStatePath) ?? {};
  const sourceCommit = getCommit();
  let channel;
  let targetVersion;

  if (releaseAction === 'beta') {
    channel = 'beta';
    targetVersion = nextBetaVersion(
      metadata.version,
      state.lastBeta?.sourceCommit === sourceCommit
        ? state.lastBeta.version
        : null,
    );
  } else if (releaseAction === 'promote') {
    channel = 'stable';
    if (!state.lastBeta) throw new Error('Nenhuma Beta local foi registrada para promoção.');
    if (state.lastBeta.sourceCommit !== sourceCommit) {
      throw new Error(
        'O código atual não corresponde exatamente à Beta aprovada. Gere e teste uma nova Beta.',
      );
    }
    targetVersion = promoteBetaVersion(state.lastBeta.version);
  } else {
    channel = 'stable';
    targetVersion = nextStableVersion(metadata.version, releaseAction);
  }

  const repository = requirePublicationEnvironment(channel);
  const buildNumber = Math.max(
    Number(metadata.buildNumber) || 1,
    Number(state.lastBuildNumber) || 1,
  ) + 1;
  const minimumSupportedVersion =
    process.env.TAGGI_MINIMUM_SUPPORTED_VERSION ?? metadata.version;
  parseVersion(minimumSupportedVersion);
  const rolloutPercentage = Number(
    process.env.TAGGI_ROLLOUT_PERCENTAGE ?? 100,
  );
  if (
    !Number.isInteger(rolloutPercentage) ||
    rolloutPercentage < 0 ||
    rolloutPercentage > 100
  ) {
    throw new Error('TAGGI_ROLLOUT_PERCENTAGE deve ser um inteiro de 0 a 100.');
  }
  const { notesPath, content: notes } = prepareReleaseNotes(targetVersion);

  runValidation();
  const preflightOutput = `release/preflight/${channel}`;
  buildInstaller({
    version: targetVersion,
    buildNumber,
    channel,
    outputDirectory: preflightOutput,
    publish: false,
    repository,
    notesPath,
  });
  const verifiedArtifacts = verifyUpdaterArtifacts(
    preflightOutput,
    channel,
    channel === 'stable',
  );
  const signing =
    verifiedArtifacts.signatureStatus === 'Valid'
      ? 'OK'
      : 'BETA CONTROLADA SEM CERTIFICADO';
  const title =
    releaseAction === 'promote'
      ? `========================================
TAGE — PROMOÇÃO PARA STABLE
========================================
Beta: ${state.lastBeta.version}
Nova Stable: ${targetVersion}
Build: OK
Testes: OK
Assinatura: ${signing}
Updater: OK
Publicar para todos os clientes Stable?`
      : `========================================
TAGE — PUBLICAÇÃO ${channel.toUpperCase()}
========================================
Versão: ${targetVersion}
Build: ${buildNumber}
Testes: OK
Assinatura: ${signing}
Canal: ${channel === 'beta' ? 'somente dispositivos Beta' : 'todos os dispositivos Stable'}`;
  const confirmationToken =
    channel === 'stable'
      ? `PUBLICAR-STABLE-${targetVersion}`
      : `PUBLICAR-BETA-${targetVersion}`;
  await confirmExact(title, confirmationToken);

  const release = {
    version: targetVersion,
    buildNumber,
    channel,
    rolloutPercentage,
    minimumSupportedVersion,
    notes,
    sourceCommit,
  };
  await syncReleaseCatalog(release, 'DRAFT');
  buildInstaller({
    version: targetVersion,
    buildNumber,
    channel,
    outputDirectory: `release/${channel}`,
    publish: true,
    repository,
    notesPath,
  });
  await syncReleaseCatalog(release, channel === 'beta' ? 'BETA' : 'STABLE');

  const nextState = {
    ...state,
    lastBuildNumber: buildNumber,
    lastPublished: release,
    ...(channel === 'beta'
      ? { lastBeta: { version: targetVersion, buildNumber, sourceCommit } }
      : {
          lastStable: { version: targetVersion, buildNumber, sourceCommit },
          lastBeta: null,
        }),
  };
  saveState(nextState);

  if (channel === 'stable') {
    const nextMetadata = readPackage();
    nextMetadata.version = targetVersion;
    nextMetadata.buildNumber = buildNumber;
    nextMetadata.taggiReleaseChannel = 'stable';
    writePackage(nextMetadata);
  }
  console.log(`\nTage ${targetVersion} publicado no canal ${channel}.`);
}

async function blockRelease() {
  const version = positional[0];
  const safeVersion = positional[1] ?? null;
  if (!version) {
    throw new Error('Informe a versão: pnpm release:block -- 1.5.1 [versão-segura].');
  }
  parseVersion(version);
  if (safeVersion) parseVersion(safeVersion);
  const repository = requirePublicationEnvironment('stable', {
    requireSigning: false,
  });
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  await confirmExact(
    `Bloquear Tage ${version}, interromper novos downloads e manter a versão instalada nos computadores atuais?`,
    `BLOQUEAR-${version}`,
  );

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const releaseResponse = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/releases/tags/v${version}`,
    { headers },
  );
  if (!releaseResponse.ok) throw new Error('A release não foi encontrada no GitHub.');
  const githubRelease = await releaseResponse.json();
  const blockResponse = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/releases/${githubRelease.id}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ draft: true }),
    },
  );
  if (!blockResponse.ok) throw new Error('O GitHub recusou o bloqueio da release.');

  const policies = await supabaseRequest(
    'taggi_release_policy?id=eq.true&select=blocked_versions',
    { method: 'GET' },
  );
  const blockedVersions = Array.from(
    new Set([...(policies?.[0]?.blocked_versions ?? []), version]),
  );
  await supabaseRequest(`taggi_app_releases?version=eq.${version}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'BLOCKED' }),
  });
  await supabaseRequest('taggi_release_policy?id=eq.true', {
    method: 'PATCH',
    body: JSON.stringify({
      blocked_versions: blockedVersions,
      ...(safeVersion
        ? { latest_version: safeVersion, stable_version: safeVersion }
        : {}),
    }),
  });
  console.log(
    'Release bloqueada. Computadores que já a instalaram exigem uma versão corretiva maior; downgrade automático permanece desativado.',
  );
}

try {
  if (action === 'status') printStatus();
  else if (action === 'build-test') await buildTest();
  else if (action === 'dry') await dryRun();
  else if (['beta', 'patch', 'minor', 'major', 'promote'].includes(action)) {
    await publishRelease(action);
  } else if (action === 'block') await blockRelease();
  else throw new Error(`Ação desconhecida: ${action}`);
} catch (error) {
  console.error('\nRELEASE INTERROMPIDA:', error.message);
  process.exitCode = 1;
}

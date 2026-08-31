const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-(beta)\.(\d+))?$/;

export function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value);
  if (!match) throw new Error(`Versão inválida: ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    prereleaseNumber: match[5] ? Number(match[5]) : null,
  };
}

export function formatVersion(version) {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease
    ? `${base}-${version.prerelease}.${version.prereleaseNumber}`
    : base;
}

export function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (!left.prerelease && !right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return Math.sign(left.prereleaseNumber - right.prereleaseNumber);
}

export function nextStableVersion(currentValue, releaseType) {
  const current = parseVersion(currentValue);
  if (releaseType === 'patch') {
    return formatVersion({
      major: current.major,
      minor: current.minor,
      patch: current.patch + 1,
    });
  }
  if (releaseType === 'minor') {
    return formatVersion({
      major: current.major,
      minor: current.minor + 1,
      patch: 0,
    });
  }
  if (releaseType === 'major') {
    return formatVersion({
      major: current.major + 1,
      minor: 0,
      patch: 0,
    });
  }
  throw new Error(`Tipo de release Stable inválido: ${releaseType}`);
}

export function nextBetaVersion(currentStableValue, previousBetaValue = null) {
  const currentStable = parseVersion(currentStableValue);
  if (currentStable.prerelease) {
    throw new Error('A versão Stable atual não pode ser uma pré-release.');
  }
  const nextMinorBase = {
    major: currentStable.major,
    minor: currentStable.minor + 1,
    patch: 0,
  };
  if (!previousBetaValue) {
    return formatVersion({
      ...nextMinorBase,
      prerelease: 'beta',
      prereleaseNumber: 1,
    });
  }
  const previous = parseVersion(previousBetaValue);
  const expectedBase = `${nextMinorBase.major}.${nextMinorBase.minor}.${nextMinorBase.patch}`;
  const previousBase = `${previous.major}.${previous.minor}.${previous.patch}`;
  if (previous.prerelease !== 'beta' || previousBase !== expectedBase) {
    return formatVersion({
      ...nextMinorBase,
      prerelease: 'beta',
      prereleaseNumber: 1,
    });
  }
  return formatVersion({
    ...nextMinorBase,
    prerelease: 'beta',
    prereleaseNumber: previous.prereleaseNumber + 1,
  });
}

export function promoteBetaVersion(betaValue) {
  const beta = parseVersion(betaValue);
  if (beta.prerelease !== 'beta') {
    throw new Error('A promoção exige uma versão Beta válida.');
  }
  return `${beta.major}.${beta.minor}.${beta.patch}`;
}

export function validateReleaseNotes(content) {
  const normalized = content.trim();
  if (!/^#\s+Tage/m.test(normalized)) {
    return 'O título deve começar com “# Tage”.';
  }
  if (!/^##\s+Novidades/m.test(normalized)) {
    return 'Inclua a seção “Novidades”.';
  }
  if (!/^##\s+Correções/m.test(normalized)) {
    return 'Inclua a seção “Correções”.';
  }
  if (
    /descreva|preencha|substitua|exemplo/i.test(normalized) ||
    !/^[-*]\s+\S+/m.test(normalized)
  ) {
    return 'Substitua os textos de exemplo por notas curtas e reais.';
  }
  return null;
}

export function resolveRepository(environment) {
  if (environment.TAGGI_GITHUB_OWNER && environment.TAGGI_GITHUB_REPO) {
    return {
      owner: environment.TAGGI_GITHUB_OWNER,
      repo: environment.TAGGI_GITHUB_REPO,
    };
  }
  if (environment.GITHUB_REPOSITORY?.includes('/')) {
    const [owner, repo] = environment.GITHUB_REPOSITORY.split('/');
    return { owner, repo };
  }
  return null;
}

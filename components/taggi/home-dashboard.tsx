'use client';

import {
  type KeyboardEvent,
  type SyntheticEvent,
  useMemo,
  useState,
} from 'react';
import {
  BarChart3,
  CircleHelp,
  CornerDownLeft,
  Plus,
  Rocket,
  Search,
} from 'lucide-react';

import { LiveCalendar } from '@/components/taggi/live-calendar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

export type HomePlatform = {
  id: string;
  name: string;
  value: number;
  accent: string;
  brandColor: string;
  initials: string;
  occurrences: number;
  logoUrl: string;
  stores: Array<{ id: string; name: string }>;
};

type HomeDashboardProps = {
  platforms: HomePlatform[];
  filteredPlatforms: HomePlatform[];
  total: number;
  selectedPlatformId: string;
  selectedStoreId: string;
  expression: string;
  launchResult: number | null;
  onPlatformChange: (id: string) => void;
  onStoreChange: (id: string) => void;
  onExpressionChange: (value: string) => void;
  onOccurrence: (platformId: string) => void;
  onLaunch: (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat('pt-BR').format(value);

function PlatformLogo({ platform }: { platform: HomePlatform }) {
  if (platform.logoUrl) {
    return (
      <span className="platform-logo relative overflow-hidden bg-white">
        {/* Imagem externa configurável: precisa funcionar no Next e no desktop Vite. */}
        {/* oxlint-disable-next-line nextjs/no-img-element */}
        <img
          src={platform.logoUrl}
          alt={'Logo ' + platform.name}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className="platform-logo"
      style={{
        background: platform.brandColor,
        color: platform.brandColor === '#080a0d' ? '#fff' : '#111',
      }}
      aria-hidden="true"
    >
      {platform.initials}
    </span>
  );
}

function PlatformCard({
  platform,
  onOccurrence,
}: {
  platform: HomePlatform;
  onOccurrence: (platformId: string) => void;
}) {
  const occurrenceLabel =
    '+' +
    platform.occurrences +
    ' ' +
    (platform.occurrences === 1 ? 'ocorrência' : 'ocorrências');

  return (
    <article className="platform-card">
      <PlatformLogo platform={platform} />
      <h2>{platform.name}</h2>
      <strong className="platform-card-value">
        {formatNumber(platform.value)}
      </strong>
      <span className="platform-card-unit">etiquetas</span>
      <button
        type="button"
        className="platform-occurrence"
        onClick={() => onOccurrence(platform.id)}
        aria-label={`${occurrenceLabel} em ${platform.name}. Registrar ocorrência`}
      >
        {occurrenceLabel}
      </button>
      <span
        className="platform-accent-line"
        style={{ color: platform.accent, background: platform.accent }}
        aria-hidden="true"
      />
    </article>
  );
}

function StoreAutocomplete({
  stores,
  selectedId,
  onSelect,
  onValidityChange,
}: {
  stores: Array<{ id: string; name: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const selected = stores.find((store) => store.id === selectedId);
  const [query, setQuery] = useState(selected?.name ?? '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return stores;
    return stores.filter((store) =>
      store.name.toLocaleLowerCase('pt-BR').includes(normalized),
    );
  }, [query, stores]);

  function choose(store: { id: string; name: string }) {
    setQuery(store.name);
    onSelect(store.id);
    onValidityChange(true);
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) =>
        matches.length ? (index + 1) % matches.length : 0,
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) =>
        matches.length ? (index - 1 + matches.length) % matches.length : 0,
      );
      return;
    }
    if (
      (event.key === 'Tab' || event.key === 'Enter') &&
      open &&
      matches[activeIndex]
    ) {
      if (event.key === 'Enter') event.preventDefault();
      choose(matches[activeIndex]);
    }
  }

  return (
    <div className="store-combobox">
      <input
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          const value = event.target.value;
          const normalized = value.trim().toLocaleLowerCase('pt-BR');
          const exact = stores.find(
            (store) =>
              store.name.trim().toLocaleLowerCase('pt-BR') === normalized,
          );
          setQuery(value);
          setOpen(true);
          setActiveIndex(0);
          if (exact) onSelect(exact.id);
          onValidityChange(Boolean(exact));
        }}
        onKeyDown={handleKeyDown}
        placeholder={
          stores.length ? 'Digite o nome da loja' : 'Cadastre uma loja'
        }
        disabled={!stores.length}
        role="combobox"
        aria-label="Sua loja"
        aria-expanded={open}
        aria-controls="quick-store-options"
        aria-autocomplete="list"
        autoComplete="off"
      />
      {open && matches.length ? (
        <div id="quick-store-options" className="store-options">
          {matches.map((store, index) => (
            <button
              key={store.id}
              type="button"
              aria-current={store.id === selectedId ? 'true' : undefined}
              data-active={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(store)}
            >
              {store.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QuickLaunch({
  platforms,
  selectedPlatformId,
  selectedStoreId,
  expression,
  launchResult,
  onPlatformChange,
  onStoreChange,
  onExpressionChange,
  onLaunch,
}: Omit<HomeDashboardProps, 'filteredPlatforms' | 'total' | 'onOccurrence'>) {
  const selectedPlatform =
    platforms.find((platform) => platform.id === selectedPlatformId) ??
    platforms[0];
  const [storeValid, setStoreValid] = useState(Boolean(selectedStoreId));
  const [attempted, setAttempted] = useState(false);
  const platformValid = Boolean(selectedPlatform);
  const quantityValid = launchResult !== null && launchResult > 0;

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setAttempted(true);
    if (!platformValid || !storeValid || !quantityValid) return;
    onLaunch(event);
    setAttempted(false);
  }

  return (
    <form
      className="surface-panel quick-launch-card"
      onSubmit={submit}
      noValidate
    >
      <header>
        <span aria-hidden="true">
          <Rocket />
        </span>
        <div>
          <h2>Lançamento rápido</h2>
          <p>Selecione a plataforma, digite a loja e informe a quantidade.</p>
        </div>
      </header>

      <div className="quick-launch-fields">
        <div className="quick-platform-field">
          <span className="sr-only">Plataforma</span>
          <NativeSelect
            aria-label="Plataforma"
            value={selectedPlatform?.id ?? ''}
            onChange={(event) => onPlatformChange(event.target.value)}
            disabled={!platforms.length}
            aria-invalid={attempted && !platformValid}
          >
            <NativeSelectOption value="">
              Selecione a plataforma
            </NativeSelectOption>
            {platforms.map((platform) => (
              <NativeSelectOption key={platform.id} value={platform.id}>
                {platform.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        <div className="quick-store-field">
          <span className="sr-only">Sua loja</span>
          <StoreAutocomplete
            key={(selectedPlatform?.id ?? 'none') + ':' + selectedStoreId}
            stores={selectedPlatform?.stores ?? []}
            selectedId={selectedStoreId}
            onSelect={onStoreChange}
            onValidityChange={setStoreValid}
          />
        </div>

        <Plus className="quick-launch-plus" aria-hidden="true" />

        <div className="quick-quantity-field">
          <span className="sr-only">Quantidade</span>
          <Input
            aria-label="Quantidade"
            className="taggi-control"
            inputMode="numeric"
            placeholder="Quantidade"
            value={expression}
            onChange={(event) => onExpressionChange(event.target.value)}
            aria-invalid={attempted && !quantityValid}
          />
        </div>

        {attempted && (!platformValid || !storeValid || !quantityValid) ? (
          <p className="quick-launch-error" role="alert">
            {!platformValid
              ? 'Selecione uma plataforma.'
              : !storeValid
                ? 'Selecione uma loja válida.'
                : 'Informe uma quantidade maior que zero.'}
          </p>
        ) : null}

        <Button className="quick-launch-submit" type="submit">
          <span>Enter para lançar</span>
          <CornerDownLeft aria-hidden="true" />
        </Button>
      </div>

      <p className="quick-launch-tip">
        <CircleHelp aria-hidden="true" />
        <span>Aprenda:</span> Digite o nome da loja e pressione
        <kbd>TAB</kbd>
        para completar.
      </p>
    </form>
  );
}

export function HomeDashboard(props: HomeDashboardProps) {
  return (
    <>
      {props.filteredPlatforms.length ? (
        <div className="platform-grid">
          {props.filteredPlatforms.map((platform) => (
            <PlatformCard
              key={platform.id}
              platform={platform}
              onOccurrence={props.onOccurrence}
            />
          ))}
          <article className="platform-card total-card">
            <h2>Total do Dia</h2>
            <strong>{formatNumber(props.total)}</strong>
            <span>etiquetas</span>
            <span className="total-card-icon" aria-hidden="true">
              <BarChart3 />
            </span>
          </article>
        </div>
      ) : (
        <div className="surface-panel grid min-h-72 place-items-center p-8 text-center">
          <div>
            <Search className="mx-auto mb-4 size-7 text-[var(--text-muted)]" />
            <p className="font-medium">
              {props.platforms.length
                ? 'Nenhuma plataforma encontrada'
                : 'Sua empresa ainda não possui plataformas'}
            </p>
            <p className="mt-1 text-sm text-[var(--text-soft)]">
              {props.platforms.length
                ? 'Tente buscar por outro nome ou loja.'
                : 'Desbloqueie a Administração e cadastre as plataformas e lojas usadas pela sua operação.'}
            </p>
          </div>
        </div>
      )}

      <div className="home-bottom-grid">
        <QuickLaunch {...props} />
        <LiveCalendar />
      </div>
    </>
  );
}

'use client';

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Bell,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Info,
  LoaderCircle,
  PackageMinus,
  Pencil,
  Plus,
  Search,
  Save,
  ShoppingCart,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { readableError } from '@/lib/taggi';
import { supabase } from '@/lib/supabase';

type Product = {
  id: string;
  name: string;
  quantity: number;
  status: string;
  sortOrder: number;
  countedQuantity: number;
  urgent: boolean;
  unit?: string;
  updatedAt?: string;
};
type InventorySession = {
  id: string;
  status: string;
  responsibleUserId: string;
  responsibleName: string;
  createdAt: string;
};
type Urgency = {
  id: string;
  sessionId: string;
  productId: string;
  productName: string;
  quantity: number;
  status: 'open' | 'ordered' | 'resolved' | 'dismissed';
  createdAt: string;
  responsibleName?: string;
  finalizedAt?: string;
};
type Withdrawal = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  responsibleName: string;
  createdAt: string;
};
type CountedItem = {
  productId: string;
  productName: string;
  previousQuantity: number;
  countedQuantity: number;
  urgent: boolean;
};
type Finalized = {
  id: string;
  responsibleName: string;
  finalizedAt: string;
  urgentCount?: number;
  items: CountedItem[];
};
type Snapshot = {
  products: Product[];
  session: InventorySession | null;
  urgencies: Urgency[];
  withdrawals: Withdrawal[];
  lastFinalized: Finalized | null;
  unreadNotificationCount: number;
  movements?: InventoryMovement[];
};
type InventoryMovement = {
  id: string;
  type: 'entry' | 'withdrawal';
  productId: string;
  productName: string;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  responsibleName: string;
  createdAt: string;
  unit?: string;
};
type AdminSnapshot = {
  reports: Finalized[];
  urgencies: Urgency[];
  withdrawals: Withdrawal[];
};
type AdminSession = { id: string; token: string };

const emptySnapshot: Snapshot = {
  products: [],
  session: null,
  urgencies: [],
  withdrawals: [],
  lastFinalized: null,
  unreadNotificationCount: 0,
};
const emptyAdminSnapshot: AdminSnapshot = {
  reports: [],
  urgencies: [],
  withdrawals: [],
};
const dateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
const lower = (value: string) => value.toLocaleLowerCase('pt-BR');
const todayKey = (value: string | Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
const timeOnly = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
const inventoryUnits = [
  { value: 'un.', label: 'Unidade (un.)' },
  { value: 'rolo', label: 'Rolo' },
  { value: 'm', label: 'Metro (m)' },
  { value: 'kg', label: 'Quilograma (kg)' },
  { value: 'cx.', label: 'Caixa (cx.)' },
];

function useInventorySnapshot(
  groupId: string,
  onToast: (message: string) => void,
  onUnreadChange?: (count: number) => void,
) {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const response = await supabase.rpc('taggi_inventory_snapshot', {
      p_group_id: groupId,
    });
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    const next = (response.data ?? emptySnapshot) as Snapshot;
    setSnapshot(next);
    setLoaded(true);
    onUnreadChange?.(next.unreadNotificationCount ?? 0);
  }, [groupId, onToast, onUnreadChange]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const filter = 'group_id=eq.' + groupId;
    const channel = client
      .channel('tage-inventory-' + groupId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_products',
          filter,
        },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_sessions',
          filter,
        },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_count_items',
          filter,
        },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_urgencies',
          filter,
        },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_withdrawals',
          filter,
        },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_notifications',
          filter,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [groupId, load]);

  return { snapshot, loaded, load };
}

function QuickEntryForm({
  products,
  selectedProductId,
  quantity,
  busy,
  onProductChange,
  onQuantityChange,
  onSubmit,
}: {
  products: Product[];
  selectedProductId: string;
  quantity: string;
  busy: boolean;
  onProductChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const selected = products.find((product) => product.id === selectedProductId);
  const addition = Math.max(0, Number(quantity) || 0);

  return (
    <form className="inventory-v3-entry-form" onSubmit={onSubmit}>
      <label className="full" htmlFor="inventory-entry-product">
        <span>Selecione o produto</span>
        <NativeSelect
          id="inventory-entry-product"
          value={selectedProductId}
          onChange={(event) => onProductChange(event.target.value)}
        >
          <NativeSelectOption value="">Selecione um produto</NativeSelectOption>
          {products.map((product) => (
            <NativeSelectOption value={product.id} key={product.id}>
              {product.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <div className="inventory-v3-entry-math">
        <div className="inventory-v3-entry-value">
          <span>Quantidade atual</span>
          <strong>
            {selected?.quantity ?? 0} {selected?.unit ?? 'un.'}
          </strong>
        </div>
        <b>+</b>
        <label htmlFor="inventory-entry-quantity">
          <span>Adicionar quantidade</span>
          <Input
            id="inventory-entry-quantity"
            className="taggi-control"
            type="number"
            min="1"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => onQuantityChange(event.target.value)}
          />
        </label>
        <b>=</b>
        <div className="total inventory-v3-entry-value">
          <span>Novo total</span>
          <strong>
            {(selected?.quantity ?? 0) + addition}{' '}
            {selected?.unit ?? 'un.'}
          </strong>
        </div>
      </div>
      <Button
        type="submit"
        className="inventory-v3-primary full"
        disabled={busy || !selected || addition <= 0}
      >
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <ArrowUpToLine className="size-4" />
        )}
        Confirmar entrada
      </Button>
    </form>
  );
}

function MovementTable({
  movements,
  title = 'Movimentações recentes',
  onViewAll,
}: {
  movements: InventoryMovement[];
  title?: string;
  onViewAll?: () => void;
}) {
  return (
    <section className="surface-panel inventory-v3-movements">
      <header>
        <div>
          <h2>{title}</h2>
          <p>Acompanhe as entradas e baixas mais recentes do estoque.</p>
        </div>
        {onViewAll ? (
          <button type="button" onClick={onViewAll}>
            Ver todas <ChevronRight className="size-4" />
          </button>
        ) : null}
      </header>
      <div className="inventory-v3-movement-row head">
        <span>Tipo</span>
        <span>Produto</span>
        <span>Quantidade</span>
        <span>Responsável</span>
        <span>Data e hora</span>
      </div>
      {movements.slice(0, 100).map((movement) => (
        <div className="inventory-v3-movement-row" key={movement.id}>
          <span className={movement.type}>
            {movement.type === 'entry' ? (
              <ArrowUp className="size-4" />
            ) : (
              <ArrowDown className="size-4" />
            )}
            {movement.type === 'entry' ? 'Entrada' : 'Baixa'}
          </span>
          <strong>{movement.productName}</strong>
          <b className={movement.type}>
            {movement.type === 'entry' ? '+' : '-'}
            {movement.quantity} {movement.unit ?? 'un.'}
          </b>
          <span>{movement.responsibleName}</span>
          <span>{dateTime(movement.createdAt)}</span>
        </div>
      ))}
      {!movements.length ? (
        <div className="inventory-empty compact">
          <ClipboardList className="size-5" />
          <p>Nenhuma movimentação registrada.</p>
        </div>
      ) : null}
    </section>
  );
}

export function InventoryPanel({
  groupId,
  active,
  onToast,
  onUnreadChange,
}: {
  groupId: string;
  active: boolean;
  onToast: (message: string) => void;
  onUnreadChange?: (count: number) => void;
}) {
  const { snapshot, loaded, load } = useInventorySnapshot(
    groupId,
    onToast,
    onUnreadChange,
  );
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [urgentIds, setUrgentIds] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'stock' | 'entry' | 'withdraw' | 'urgency' | 'reports'
  >('stock');
  const [productSearch, setProductSearch] = useState('');
  const [urgencySearch, setUrgencySearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState('0');
  const [newUnit, setNewUnit] = useState('un.');
  const [entryProductId, setEntryProductId] = useState('');
  const [entryQuantity, setEntryQuantity] = useState('1');
  const [withdrawSearch, setWithdrawSearch] = useState('');
  const [withdrawProductId, setWithdrawProductId] = useState('');
  const [withdrawQuantity, setWithdrawQuantity] = useState('1');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionCursor, setSuggestionCursor] = useState(0);
  const [allWithdrawals, setAllWithdrawals] = useState<Withdrawal[] | null>(
    null,
  );
  const [busy, setBusy] = useState('');
  const firstUseStarted = useRef(false);

  useEffect(() => {
    setCounts(
      Object.fromEntries(
        snapshot.products.map((product) => [
          product.id,
          Math.max(0, product.countedQuantity ?? product.quantity),
        ]),
      ),
    );
    setUrgentIds(
      new Set(
        snapshot.products
          .filter((product) => product.urgent)
          .map((product) => product.id),
      ),
    );
  }, [snapshot.products]);

  const beginInventory = useCallback(
    async (firstUse = false) => {
      if (!supabase || busy) return;
      setBusy('begin');
      const response = await supabase.rpc('taggi_inventory_begin', {
        p_group_id: groupId,
      });
      setBusy('');
      if (response.error) {
        onToast(readableError(response.error));
        return;
      }
      if (firstUse) setEditMode(true);
      await load();
      onToast(
        firstUse
          ? 'Cadastre a lista base dos Insumos.'
          : 'Novo insumo iniciado.',
      );
    },
    [busy, groupId, load, onToast],
  );

  useEffect(() => {
    if (
      active &&
      loaded &&
      !snapshot.session &&
      snapshot.products.length === 0 &&
      !firstUseStarted.current
    ) {
      firstUseStarted.current = true;
      void beginInventory(true);
    }
  }, [
    active,
    beginInventory,
    loaded,
    snapshot.products.length,
    snapshot.session,
  ]);

  const visibleProducts = useMemo(
    () =>
      snapshot.products.filter((product) =>
        lower(product.name).includes(lower(productSearch.trim())),
      ),
    [productSearch, snapshot.products],
  );
  const urgencyProducts = useMemo(
    () =>
      snapshot.products.filter((product) =>
        lower(product.name).includes(lower(urgencySearch.trim())),
      ),
    [snapshot.products, urgencySearch],
  );
  const withdrawalSuggestions = useMemo(
    () =>
      snapshot.products
        .filter((product) =>
          lower(product.name).includes(lower(withdrawSearch.trim())),
        )
        .slice(0, 8),
    [snapshot.products, withdrawSearch],
  );
  const selectedWithdrawal = snapshot.products.find(
    (product) => product.id === withdrawProductId,
  );

  async function addProduct(event: FormEvent) {
    event.preventDefault();
    if (!supabase || newName.trim().length < 2) return;
    setBusy('product');
    let response = await supabase.rpc('taggi_inventory_save_product', {
      p_group_id: groupId,
      p_product_id: null,
      p_name: newName.trim(),
      p_initial_quantity: Math.max(0, Number(newQuantity) || 0),
      p_unit: newUnit,
    });
    if (response.error?.code === 'PGRST202') {
      response = await supabase.rpc('taggi_inventory_save_product', {
        p_group_id: groupId,
        p_product_id: null,
        p_name: newName.trim(),
        p_initial_quantity: Math.max(0, Number(newQuantity) || 0),
      });
    }
    setBusy('');
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    setNewName('');
    setNewQuantity('0');
    setNewUnit('un.');
    setNewProductOpen(false);
    await load();
    onToast('Item adicionado à lista base.');
  }

  async function saveProduct(product: Product, name: string, quantity: number) {
    if (!supabase || name.trim().length < 2 || quantity < 0) return;
    let response = await supabase.rpc('taggi_inventory_save_product', {
      p_group_id: groupId,
      p_product_id: product.id,
      p_name: name.trim(),
      p_initial_quantity: quantity,
      p_unit: product.unit ?? 'un.',
    });
    if (response.error?.code === 'PGRST202') {
      response = await supabase.rpc('taggi_inventory_save_product', {
        p_group_id: groupId,
        p_product_id: product.id,
        p_name: name.trim(),
        p_initial_quantity: quantity,
      });
    }
    if (response.error) onToast(readableError(response.error));
    else await load();
  }

  async function archiveProduct(product: Product) {
    if (!supabase) return;
    setBusy('product');
    const response = await supabase.rpc('taggi_inventory_archive_product', {
      p_group_id: groupId,
      p_product_id: product.id,
    });
    setBusy('');
    if (response.error) onToast(readableError(response.error));
    else {
      await load();
      onToast('Item removido da lista ativa.');
    }
  }

  async function persistDraft(
    product: Product,
    quantity: number,
    urgent: boolean,
  ) {
    if (!supabase || !snapshot.session) return;
    const response = await supabase.rpc('taggi_inventory_update_draft_item', {
      p_group_id: groupId,
      p_session_id: snapshot.session.id,
      p_product_id: product.id,
      p_quantity: Math.max(0, quantity),
      p_urgent: urgent,
    });
    if (response.error) onToast(readableError(response.error));
  }

  async function toggleUrgent(product: Product, checked: boolean) {
    setUrgentIds((current) => {
      const next = new Set(current);
      if (checked) next.add(product.id);
      else next.delete(product.id);
      return next;
    });
    await persistDraft(
      product,
      counts[product.id] ?? product.quantity,
      checked,
    );
  }

  async function finalizeInventory() {
    if (!supabase || !snapshot.session || !snapshot.products.length) return;
    setBusy('finalize');
    const response = await supabase.rpc('taggi_inventory_finalize', {
      p_group_id: groupId,
      p_session_id: snapshot.session.id,
      p_items: snapshot.products.map((product) => ({
        productId: product.id,
        quantity: Math.max(0, counts[product.id] ?? product.quantity),
      })),
      p_urgent_product_ids: [...urgentIds],
    });
    setBusy('');
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    setEditMode(false);
    await load();
    onToast('Insumo finalizado e relatório enviado à Administração.');
  }

  function selectWithdrawal(product: Product) {
    setWithdrawProductId(product.id);
    setWithdrawSearch(product.name);
    setSuggestionsOpen(false);
  }

  function handleWithdrawalKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggestionsOpen || !withdrawalSuggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSuggestionCursor((current) =>
        Math.min(current + 1, withdrawalSuggestions.length - 1),
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSuggestionCursor((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectWithdrawal(withdrawalSuggestions[suggestionCursor]);
    } else if (event.key === 'Escape') {
      setSuggestionsOpen(false);
    }
  }

  async function withdraw(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selectedWithdrawal) {
      onToast('Selecione um produto da lista.');
      return;
    }
    const quantity = Number(withdrawQuantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      onToast('Informe uma quantidade válida.');
      return;
    }
    setBusy('withdraw');
    const response = await supabase.rpc('taggi_inventory_withdraw', {
      p_group_id: groupId,
      p_product_id: selectedWithdrawal.id,
      p_quantity: quantity,
    });
    setBusy('');
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    setWithdrawQuantity('1');
    setWithdrawProductId('');
    setWithdrawSearch('');
    await load();
    onToast('Baixa registrada e sincronizada.');
  }

  async function loadWithdrawalHistory() {
    if (!supabase) return;
    const response = await supabase
      .from('taggi_inventory_withdrawals')
      .select(
        'id,product_id,product_name,quantity,previous_quantity,new_quantity,responsible_name,created_at',
      )
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    setAllWithdrawals(
      (response.data ?? []).map((item) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        quantity: item.quantity,
        previousQuantity: item.previous_quantity,
        newQuantity: item.new_quantity,
        responsibleName: item.responsible_name,
        createdAt: item.created_at,
      })),
    );
  }

  async function addStock(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const product = snapshot.products.find(
      (item) => item.id === entryProductId,
    );
    const quantity = Number(entryQuantity);
    if (!product) {
      onToast('Selecione um produto.');
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      onToast('Informe uma quantidade válida.');
      return;
    }
    setBusy('entry');
    const response = await supabase.rpc('taggi_inventory_adjust_stock', {
      p_group_id: groupId,
      p_product_id: product.id,
      p_quantity: quantity,
      p_kind: 'entry',
    });
    if (response.error?.code === 'PGRST202') {
      if (snapshot.session) {
        setBusy('');
        onToast(
          'Finalize o insumo em andamento antes de registrar uma entrada.',
        );
        return;
      }
      const beginResponse = await supabase.rpc('taggi_inventory_begin', {
        p_group_id: groupId,
      });
      if (beginResponse.error) {
        setBusy('');
        onToast(readableError(beginResponse.error));
        return;
      }
      const refreshed = await supabase.rpc('taggi_inventory_snapshot', {
        p_group_id: groupId,
      });
      const nextSnapshot = (refreshed.data ?? emptySnapshot) as Snapshot;
      const fallbackSession = nextSnapshot.session;
      if (!fallbackSession) {
        setBusy('');
        onToast('Não foi possível iniciar a entrada.');
        return;
      }
      const finalizeResponse = await supabase.rpc('taggi_inventory_finalize', {
        p_group_id: groupId,
        p_session_id: fallbackSession.id,
        p_items: nextSnapshot.products.map((item) => ({
          productId: item.id,
          quantity:
            item.id === product.id
              ? Math.max(0, item.quantity + quantity)
              : item.quantity,
        })),
        p_urgent_product_ids: [],
      });
      setBusy('');
      if (finalizeResponse.error) {
        onToast(readableError(finalizeResponse.error));
        return;
      }
    } else {
      setBusy('');
      if (response.error) {
        onToast(readableError(response.error));
        return;
      }
    }
    setEntryQuantity('1');
    await load();
    onToast('Entrada confirmada e sincronizada.');
  }

  const displayedWithdrawals = allWithdrawals ?? snapshot.withdrawals;
  const derivedEntries: InventoryMovement[] = snapshot.lastFinalized
    ? snapshot.lastFinalized.items
        .filter((item) => item.countedQuantity > item.previousQuantity)
        .map((item) => ({
          id: snapshot.lastFinalized!.id + '-' + item.productId,
          type: 'entry' as const,
          productId: item.productId,
          productName: item.productName,
          quantity: item.countedQuantity - item.previousQuantity,
          previousQuantity: item.previousQuantity,
          newQuantity: item.countedQuantity,
          responsibleName: snapshot.lastFinalized!.responsibleName,
          createdAt: snapshot.lastFinalized!.finalizedAt,
          unit:
            snapshot.products.find((product) => product.id === item.productId)
              ?.unit ?? 'un.',
        }))
    : [];
  const recentMovements = (
    snapshot.movements ?? [
      ...derivedEntries,
      ...displayedWithdrawals.map((item) => ({
        ...item,
        type: 'withdrawal' as const,
        unit:
          snapshot.products.find((product) => product.id === item.productId)
            ?.unit ?? 'un.',
      })),
    ]
  )
    .slice()
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
  const stockTotal = snapshot.products.reduce(
    (total, product) => total + product.quantity,
    0,
  );
  const today = todayKey(new Date());
  const withdrawnToday = snapshot.withdrawals
    .filter((item) => todayKey(item.createdAt) === today)
    .reduce((total, item) => total + item.quantity, 0);
  const lastMovement = recentMovements[0];

  return (
    <div className={active ? 'inventory-page inventory-v3' : 'hidden'}>
      <header className="inventory-v3-heading">
        <div>
          <h1>Insumos</h1>
          <p>
            Gerencie os produtos em estoque e mantenha tudo sempre organizado.
          </p>
        </div>
      </header>

      <nav className="inventory-v3-tabs" aria-label="Seções de insumos">
        {[
          ['stock', 'Estoque'],
          ['entry', 'Entrada rápida'],
          ['withdraw', 'Dar baixa'],
          ['urgency', 'Urgência para compra'],
          ['reports', 'Relatórios enviados'],
        ].map(([id, label]) => (
          <button
            type="button"
            className={activeTab === id ? 'active' : ''}
            key={id}
            onClick={() =>
              setActiveTab(
                id as
                  | 'stock'
                  | 'entry'
                  | 'withdraw'
                  | 'urgency'
                  | 'reports',
              )
            }
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === 'stock' ? (
      <section className="inventory-v3-stats" aria-label="Resumo do estoque">
        <article className="surface-panel">
          <span><Box className="size-6" /></span>
          <div>
            <small>Total de produtos</small>
            <strong>{snapshot.products.length}</strong>
            <p>cadastrados</p>
          </div>
        </article>
        <article className="surface-panel">
          <span><Box className="size-6" /></span>
          <div>
            <small>Em estoque</small>
            <strong>{stockTotal}</strong>
            <p>unidades</p>
          </div>
        </article>
        <article className="surface-panel">
          <span><ArrowDown className="size-6" /></span>
          <div>
            <small>Baixas hoje</small>
            <strong>{withdrawnToday}</strong>
            <p>unidades</p>
          </div>
        </article>
        <article className="surface-panel">
          <span><Clock3 className="size-6" /></span>
          <div>
            <small>Última atualização</small>
            <strong>
              {lastMovement
                ? 'Hoje ' + timeOnly(lastMovement.createdAt)
                : '—'}
            </strong>
            <p>
              {lastMovement
                ? 'por ' + lastMovement.responsibleName
                : 'sem movimentações'}
            </p>
          </div>
        </article>
      </section>
      ) : null}

      {activeTab === 'stock' ? (
        <>
          <div
            className={
              'inventory-v3-stock-grid' + (newProductOpen ? '' : ' single')
            }
          >
            <section className="surface-panel inventory-v3-product-card">
              <header>
                <div>
                  <h2>Lista de insumos</h2>
                  <p>Visualize e gerencie todos os produtos em estoque.</p>
                </div>
                <div className="inventory-v3-product-actions">
                  <label className="inventory-search">
                    <Search className="size-4" />
                    <input
                      placeholder="Buscar produto..."
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    className="inventory-v3-primary"
                    onClick={() => {
                      setNewProductOpen(true);
                      window.requestAnimationFrame(() =>
                        document
                          .getElementById('inventory-new-product-name')
                          ?.focus(),
                      );
                    }}
                  >
                    <Plus className="size-4" />
                    Novo produto
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="taggi-button-subtle"
                    onClick={() => setEditMode((value) => !value)}
                  >
                    {editMode ? (
                      <Check className="size-4" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    {editMode ? 'Concluir edição' : 'Salvar alterações'}
                  </Button>
                </div>
              </header>

              <div className="inventory-v3-table">
                <div className="inventory-v3-row head">
                  <span>Produto</span>
                  <span>Quantidade atual</span>
                  <span>Unidade</span>
                  <span>Última movimentação</span>
                  <span>Ações</span>
                </div>
                {visibleProducts.map((product) => (
                  <div className="inventory-v3-row" key={product.id}>
                    {editMode ? (
                      <Input
                        defaultValue={product.name}
                        className="taggi-control inventory-v3-inline"
                        aria-label={'Nome de ' + product.name}
                        onBlur={(event) =>
                          void saveProduct(
                            product,
                            event.target.value,
                            counts[product.id] ?? product.quantity,
                          )
                        }
                      />
                    ) : (
                      <strong>{product.name}</strong>
                    )}
                    {editMode ? (
                      <Input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        className="taggi-control inventory-v3-quantity"
                        aria-label={'Quantidade de ' + product.name}
                        value={counts[product.id] ?? product.quantity}
                        onChange={(event) =>
                          setCounts((current) => ({
                            ...current,
                            [product.id]: Math.max(
                              0,
                              Number(event.target.value) || 0,
                            ),
                          }))
                        }
                        onBlur={(event) =>
                          void saveProduct(
                            product,
                            product.name,
                            Math.max(0, Number(event.target.value) || 0),
                          )
                        }
                      />
                    ) : (
                      <b>{product.quantity}</b>
                    )}
                    <span>{product.unit ?? 'un.'}</span>
                    <span>
                      {product.updatedAt
                        ? dateTime(product.updatedAt)
                        : lastMovement?.productId === product.id
                          ? 'Hoje ' + timeOnly(lastMovement.createdAt)
                          : '—'}
                    </span>
                    <div className="inventory-v3-row-actions">
                      <button
                        type="button"
                        title="Editar produto"
                        aria-label={'Editar ' + product.name}
                        onClick={() => setEditMode(true)}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        title="Adicionar entrada"
                        aria-label={'Adicionar entrada em ' + product.name}
                        onClick={() => {
                          setEntryProductId(product.id);
                          setActiveTab('entry');
                        }}
                      >
                        <Plus className="size-4" />
                      </button>
                      {editMode ? (
                        <button
                          type="button"
                          className="danger"
                          title="Arquivar produto"
                          aria-label={'Arquivar ' + product.name}
                          onClick={() => void archiveProduct(product)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!visibleProducts.length ? (
                  <div className="inventory-empty">
                    <Box className="size-6" />
                    <p>Nenhum produto encontrado.</p>
                  </div>
                ) : null}
              </div>
              <footer>
                <Info className="size-4" />
                {snapshot.products.length} produtos encontrados
              </footer>
            </section>

            {newProductOpen ? (
            <aside className="inventory-v3-side">
              <section className="surface-panel inventory-v3-new-product">
                <header>
                  <span><Box className="size-5" /></span>
                  <div>
                    <h2>Adicionar novo insumo</h2>
                    <p>Inclua um novo produto no estoque.</p>
                  </div>
                  <button
                    type="button"
                    className="inventory-v3-close-form"
                    onClick={() => setNewProductOpen(false)}
                  >
                    Cancelar
                  </button>
                </header>
                <form onSubmit={addProduct}>
                  <label htmlFor="inventory-new-product-name">
                    <span>Nome do produto</span>
                    <Input
                      id="inventory-new-product-name"
                      className="taggi-control"
                      placeholder="Digite o nome do produto"
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                    />
                  </label>
                  <label htmlFor="inventory-new-product-quantity">
                    <span>Quantidade inicial</span>
                    <Input
                      id="inventory-new-product-quantity"
                      className="taggi-control"
                      type="number"
                      min="0"
                      inputMode="numeric"
                      placeholder="Ex: 10"
                      value={newQuantity}
                      onChange={(event) => setNewQuantity(event.target.value)}
                    />
                  </label>
                  <label htmlFor="inventory-new-product-unit">
                    <span>Unidade</span>
                    <NativeSelect
                      id="inventory-new-product-unit"
                      value={newUnit}
                      onChange={(event) => setNewUnit(event.target.value)}
                    >
                      {inventoryUnits.map((unit) => (
                        <NativeSelectOption value={unit.value} key={unit.value}>
                          {unit.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <Button
                    type="submit"
                    className="inventory-v3-primary"
                    disabled={busy === 'product' || newName.trim().length < 2}
                  >
                    {busy === 'product' ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    Adicionar produto
                  </Button>
                </form>
              </section>
            </aside>
            ) : null}
          </div>
        </>
      ) : null}

      {activeTab === 'entry' ? (
        <div className="inventory-v3-focused-grid">
          <section className="surface-panel inventory-v3-focus-card">
            <header>
              <span><ArrowUpToLine className="size-5" /></span>
              <div>
                <h2>Entrada rápida</h2>
                <p>Some unidades a um produto sem alterar os demais saldos.</p>
              </div>
            </header>
            <QuickEntryForm
              products={snapshot.products}
              selectedProductId={entryProductId}
              quantity={entryQuantity}
              busy={busy === 'entry'}
              onProductChange={setEntryProductId}
              onQuantityChange={setEntryQuantity}
              onSubmit={addStock}
            />
          </section>
          <MovementTable
            movements={recentMovements.filter((item) => item.type === 'entry')}
            title="Últimas entradas"
          />
        </div>
      ) : null}

      {activeTab === 'withdraw' ? (
        <div className="inventory-v3-focused-grid">
          <section className="surface-panel inventory-withdraw inventory-v3-focus-card">
            <header>
              <ArrowDownToLine className="size-5" />
              <div>
                <h2>Dar baixa</h2>
                <p>Registre os itens utilizados e mantenha o saldo atualizado.</p>
              </div>
            </header>
            <form onSubmit={withdraw}>
              <div className="inventory-autocomplete">
                <label className="inventory-search wide">
                  <Search className="size-4" />
                  <input
                    placeholder="Buscar produto pelo nome..."
                    value={withdrawSearch}
                    autoComplete="off"
                    onFocus={() => setSuggestionsOpen(true)}
                    onChange={(event) => {
                      setWithdrawSearch(event.target.value);
                      setWithdrawProductId('');
                      setSuggestionCursor(0);
                      setSuggestionsOpen(true);
                    }}
                    onKeyDown={handleWithdrawalKeys}
                  />
                </label>
                {suggestionsOpen && withdrawSearch.trim() ? (
                  <div className="inventory-suggestions">
                    {withdrawalSuggestions.map((product, index) => (
                      <button
                        type="button"
                        className={index === suggestionCursor ? 'active' : ''}
                        key={product.id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectWithdrawal(product)}
                      >
                        <span>{product.name}</span>
                        <small>{product.quantity} disponíveis</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <label
                className="inventory-field"
                htmlFor="inventory-withdraw-quantity"
              >
                <span>Quantidade</span>
                <Input
                  id="inventory-withdraw-quantity"
                  className="taggi-control"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={withdrawQuantity}
                  onChange={(event) => setWithdrawQuantity(event.target.value)}
                />
              </label>
              <div className="inventory-field inventory-responsible-field">
                <span>Disponível</span>
                <strong>{selectedWithdrawal?.quantity ?? '—'}</strong>
              </div>
              <Button
                type="submit"
                className="inventory-v3-primary"
                disabled={busy === 'withdraw' || !selectedWithdrawal}
              >
                {busy === 'withdraw' ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  'Dar baixa'
                )}
              </Button>
            </form>
          </section>
          <MovementTable
            movements={recentMovements.filter(
              (item) => item.type === 'withdrawal',
            )}
            title="Últimas baixas"
            onViewAll={() => void loadWithdrawalHistory()}
          />
        </div>
      ) : null}

      {activeTab === 'urgency' ? (
        <section className="surface-panel inventory-v3-urgency">
          <header>
            <div>
              <h2><ShoppingCart className="size-5" /> Urgência para compra</h2>
              <p>Marque os produtos e envie a lista para a Administração.</p>
            </div>
            {snapshot.session ? (
              <Button
                type="button"
                className="inventory-v3-primary"
                disabled={busy === 'finalize' || !snapshot.products.length}
                onClick={() => void finalizeInventory()}
              >
                {busy === 'finalize' ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Finalizar e enviar
              </Button>
            ) : (
              <Button
                type="button"
                className="inventory-v3-primary"
                disabled={busy === 'begin'}
                onClick={() => void beginInventory()}
              >
                <Plus className="size-4" />
                Iniciar seleção
              </Button>
            )}
          </header>
          <label className="inventory-search wide">
            <Search className="size-4" />
            <input
              placeholder="Pesquisar item..."
              value={urgencySearch}
              onChange={(event) => setUrgencySearch(event.target.value)}
            />
          </label>
          <div className="inventory-urgency-list">
            {urgencyProducts.map((product) => {
              const checked = urgentIds.has(product.id);
              return (
                <label className={checked ? 'selected' : ''} key={product.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!snapshot.session}
                    onChange={(event) =>
                      void toggleUrgent(product, event.target.checked)
                    }
                  />
                  <span>
                    <strong>{product.name}</strong>
                    {checked ? <small>URGENTE</small> : null}
                  </span>
                  <b>{counts[product.id] ?? product.quantity}</b>
                </label>
              );
            })}
          </div>
          <p className="inventory-note">
            <Info className="size-4" />
            Ao finalizar, os itens marcados aparecerão na Administração.
          </p>
        </section>
      ) : null}

      {activeTab === 'reports' ? (
        <div className="inventory-v3-focused-grid">
          <section className="surface-panel inventory-v3-report">
            <header>
              <div>
                <h2><ClipboardList className="size-5" /> Relatórios enviados</h2>
                <p>Última contagem finalizada e sincronizada com a equipe.</p>
              </div>
            </header>
            {snapshot.lastFinalized ? (
              <>
                <div className="inventory-v3-report-meta">
                  <span>
                    <small>Responsável</small>
                    <strong>{snapshot.lastFinalized.responsibleName}</strong>
                  </span>
                  <span>
                    <small>Data e hora</small>
                    <strong>{dateTime(snapshot.lastFinalized.finalizedAt)}</strong>
                  </span>
                </div>
                <div className="inventory-v3-report-list">
                  {snapshot.lastFinalized.items.map((item) => (
                    <div key={item.productId}>
                      <strong>{item.productName}</strong>
                      <span>{item.previousQuantity} anteriores</span>
                      <b>{item.countedQuantity}</b>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="inventory-empty">
                <ClipboardList className="size-6" />
                <p>Nenhum relatório enviado.</p>
              </div>
            )}
          </section>
          <MovementTable movements={recentMovements} />
        </div>
      ) : null}

      {!loaded ? (
        <div className="inventory-v3-loading">
          <LoaderCircle className="size-5 animate-spin" />
          Carregando estoque...
        </div>
      ) : null}
    </div>
  );

  /*
  return (
    <div className={active ? 'inventory-page' : 'hidden'}>
      <div className="inventory-heading">
        <div>
          <h1>Insumos</h1>
          <p>Gerencie os produtos utilizados e acompanhe as baixas.</p>
        </div>
      </div>

      <section className="surface-panel inventory-current">
        <div className="inventory-current-title">
          <span className="inventory-title-icon">
            <Box className="size-5" />
          </span>
          <div>
            <h2>Insumo atual</h2>
            <p>
              {snapshot.session
                ? 'Contagem em andamento'
                : 'Lista pronta para a próxima contagem'}
            </p>
          </div>
          <i />
          <div className="inventory-responsible">
            <small>Responsável</small>
            <strong>
              {snapshot.session?.responsibleName ??
                snapshot.lastFinalized?.responsibleName ??
                'Equipe Tage'}
            </strong>
          </div>
        </div>
        <div className="inventory-current-actions">
          <Button
            variant="outline"
            className="taggi-button-subtle"
            onClick={() => setEditMode((value) => !value)}
          >
            <Pencil className="size-4" />
            {editMode ? 'Concluir edição' : 'Editar insumo'}
          </Button>
          {snapshot.session ? (
            <Button
              className="inventory-finish-button"
              onClick={() => void finalizeInventory()}
              disabled={busy === 'finalize' || !snapshot.products.length}
            >
              {busy === 'finalize' ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Finalizar insumo
            </Button>
          ) : (
            <Button
              className="inventory-finish-button"
              onClick={() => void beginInventory()}
              disabled={busy === 'begin'}
            >
              {busy === 'begin' ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Iniciar insumo
            </Button>
          )}
          <button
            className="inventory-more-button"
            type="button"
            aria-label="Mais opções do insumo"
            title="Mais opções"
            onClick={() => setEditMode((value) => !value)}
          >
            <MoreHorizontal className="size-5" />
          </button>
        </div>
      </section>

      <div className="inventory-info-strip">
        <Info className="size-4" />
        <span>
          Ao finalizar, as urgências selecionadas serão enviadas para
          Administração e notificarão somente os cargos Administrador e Gestor.
        </span>
      </div>

      <div className="inventory-work-grid">
        <section className="surface-panel inventory-products">
          <header>
            <div>
              <h2>
                <Box className="size-4" />
                Itens do insumo
              </h2>
              <p>{snapshot.products.length} itens ativos</p>
            </div>
            <label className="inventory-search">
              <Search className="size-4" />
              <input
                placeholder="Pesquisar item..."
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
              />
            </label>
          </header>
          <div className="inventory-product-table">
            <div className="inventory-product-row head">
              <span>Produto</span>
              <span>{snapshot.session ? 'Qtd. contada' : 'Qtd. atual'}</span>
              <span />
            </div>
            {visibleProducts.map((product) => (
              <div className="inventory-product-row" key={product.id}>
                {editMode ? (
                  <Input
                    defaultValue={product.name}
                    aria-label={'Nome de ' + product.name}
                    className="taggi-control inventory-inline-input"
                    onBlur={(event) =>
                      void saveProduct(
                        product,
                        event.target.value,
                        counts[product.id] ?? product.quantity,
                      )
                    }
                  />
                ) : (
                  <strong>{product.name}</strong>
                )}
                {snapshot.session || editMode ? (
                  <Input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    aria-label={'Quantidade de ' + product.name}
                    className="taggi-control inventory-quantity-input"
                    value={
                      snapshot.session
                        ? (counts[product.id] ?? product.quantity)
                        : product.quantity
                    }
                    onChange={(event) => {
                      if (!snapshot.session) return;
                      setCounts((current) => ({
                        ...current,
                        [product.id]: Math.max(
                          0,
                          Number(event.target.value) || 0,
                        ),
                      }));
                    }}
                    onBlur={(event) => {
                      const quantity = Math.max(
                        0,
                        Number(event.target.value) || 0,
                      );
                      if (snapshot.session) {
                        void persistDraft(
                          product,
                          quantity,
                          urgentIds.has(product.id),
                        );
                      } else {
                        void saveProduct(product, product.name, quantity);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                ) : (
                  <b>{product.quantity}</b>
                )}
                {editMode ? (
                  <button
                    type="button"
                    aria-label={'Remover ' + product.name}
                    onClick={() => void archiveProduct(product)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            {!visibleProducts.length ? (
              <div className="inventory-empty compact">
                <Box className="size-5" />
                <p>Nenhum item encontrado.</p>
              </div>
            ) : null}
          </div>
          {editMode ? (
            <form className="inventory-add-product" onSubmit={addProduct}>
              <Input
                className="taggi-control"
                placeholder="Nome do novo item"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <Input
                className="taggi-control"
                type="number"
                min="0"
                inputMode="numeric"
                aria-label="Quantidade inicial"
                value={newQuantity}
                onChange={(event) => setNewQuantity(event.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                className="taggi-button-subtle"
                disabled={busy === 'product' || newName.trim().length < 2}
              >
                {busy === 'product' ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Adicionar item
              </Button>
            </form>
          ) : null}
        </section>

        <section className="surface-panel inventory-urgency-picker">
          <header>
            <div>
              <h2>Urgência para compra</h2>
              <p>Selecione os itens que precisam ser comprados.</p>
            </div>
            <Info className="size-4" />
          </header>
          <label className="inventory-search wide">
            <Search className="size-4" />
            <input
              placeholder="Pesquisar item..."
              value={urgencySearch}
              onChange={(event) => setUrgencySearch(event.target.value)}
            />
          </label>
          <p className="inventory-picker-hint">
            {snapshot.session
              ? 'A seleção é salva e sincronizada em tempo real.'
              : 'Inicie um insumo para marcar as próximas urgências.'}
          </p>
          <div className="inventory-urgency-list">
            {urgencyProducts.map((product) => {
              const checked = urgentIds.has(product.id);
              return (
                <label className={checked ? 'selected' : ''} key={product.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!snapshot.session}
                    onChange={(event) =>
                      void toggleUrgent(product, event.target.checked)
                    }
                  />
                  <span>
                    <strong>{product.name}</strong>
                    {checked ? <small>URGENTE</small> : null}
                  </span>
                  <b>{counts[product.id] ?? product.quantity}</b>
                </label>
              );
            })}
            {!urgencyProducts.length ? (
              <div className="inventory-empty compact">
                <ShoppingCart className="size-5" />
                <p>Nenhum item encontrado.</p>
              </div>
            ) : null}
          </div>
          <div className="inventory-picker-note">
            <Info className="size-4" />
            <span>
              Após a finalização, os itens marcados aparecerão na Administração.
            </span>
          </div>
        </section>
      </div>

      <section className="surface-panel inventory-withdraw">
        <header>
          <PackageMinus className="size-5" />
          <div>
            <h2>Dar baixa</h2>
            <p>Registre os itens utilizados e envie o relatório.</p>
          </div>
        </header>
        <form onSubmit={withdraw}>
          <div className="inventory-autocomplete">
            <label className="inventory-search wide">
              <Search className="size-4" />
              <input
                placeholder="Buscar produto pelo nome..."
                value={withdrawSearch}
                autoComplete="off"
                onFocus={() => setSuggestionsOpen(true)}
                onChange={(event) => {
                  setWithdrawSearch(event.target.value);
                  setWithdrawProductId('');
                  setSuggestionCursor(0);
                  setSuggestionsOpen(true);
                }}
                onKeyDown={handleWithdrawalKeys}
              />
            </label>
            {suggestionsOpen && withdrawSearch.trim() ? (
              <div className="inventory-suggestions">
                {withdrawalSuggestions.map((product, index) => (
                  <button
                    type="button"
                    className={index === suggestionCursor ? 'active' : ''}
                    key={product.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectWithdrawal(product)}
                  >
                    <span>{product.name}</span>
                    <small>{product.quantity} disponíveis</small>
                  </button>
                ))}
                {!withdrawalSuggestions.length ? (
                  <p>Nenhum produto encontrado.</p>
                ) : null}
              </div>
            ) : null}
          </div>
          <label className="inventory-field">
            <span>Quantidade</span>
            <Input
              className="taggi-control"
              type="number"
              min="1"
              inputMode="numeric"
              value={withdrawQuantity}
              onChange={(event) => setWithdrawQuantity(event.target.value)}
            />
          </label>
          <div className="inventory-field inventory-responsible-field">
            <span>Disponível</span>
            <strong>{selectedWithdrawal?.quantity ?? '—'}</strong>
          </div>
          <Button
            type="submit"
            className="inventory-finish-button"
            disabled={busy === 'withdraw' || !selectedWithdrawal}
          >
            {busy === 'withdraw' ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              'Dar baixa'
            )}
          </Button>
        </form>
        <p className="inventory-note">
          <Info className="size-4" />
          O estoque é validado no servidor para impedir quantidade negativa.
        </p>
      </section>

      <section className="surface-panel inventory-history">
        <header>
          <div>
            <h2>Últimas baixas</h2>
            <p>Movimentações sincronizadas da equipe.</p>
          </div>
          <button type="button" onClick={() => void loadWithdrawalHistory()}>
            Ver histórico completo
            <ChevronRight className="size-4" />
          </button>
        </header>
        {displayedWithdrawals.length ? (
          <div className="inventory-history-list">
            {displayedWithdrawals.map((item) => (
              <article key={item.id}>
                <span>
                  <strong>{item.productName}</strong>
                  <small>
                    {dateTime(item.createdAt)} • {item.responsibleName}
                  </small>
                </span>
                <b>-{item.quantity}</b>
                <em>{item.newQuantity} restantes</em>
              </article>
            ))}
          </div>
        ) : (
          <div className="inventory-empty compact">
            <ClipboardList className="size-5" />
            <p>Nenhuma baixa registrada.</p>
          </div>
        )}
      </section>
    </div>
  );
  */
}

export function InventoryAdminPanel({
  groupId,
  active,
  adminSession,
  onToast,
  onUnreadChange,
}: {
  groupId: string;
  active: boolean;
  adminSession: AdminSession | null;
  onToast: (message: string) => void;
  onUnreadChange?: (count: number) => void;
}) {
  const [snapshot, setSnapshot] = useState<AdminSnapshot>(emptyAdminSnapshot);
  const [busyId, setBusyId] = useState('');
  const [expandedReport, setExpandedReport] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | Urgency['status']>(
    'all',
  );

  const load = useCallback(async () => {
    if (!supabase || !adminSession) return;
    const response = await supabase.rpc('taggi_inventory_admin_snapshot', {
      p_group_id: groupId,
      p_admin_session_id: adminSession.id,
      p_admin_session_token: adminSession.token,
    });
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    setSnapshot((response.data ?? emptyAdminSnapshot) as AdminSnapshot);
  }, [adminSession, groupId, onToast]);

  useEffect(() => {
    if (!active || !adminSession || !supabase) return;
    void load();
    void supabase
      .rpc('taggi_inventory_mark_notifications_read', {
        p_group_id: groupId,
      })
      .then(({ error }) => {
        if (!error) onUnreadChange?.(0);
      });
  }, [active, adminSession, groupId, load, onUnreadChange]);

  useEffect(() => {
    if (!supabase || !adminSession) return;
    const client = supabase;
    const filter = 'group_id=eq.' + groupId;
    const channel = client
      .channel('tage-inventory-admin-' + groupId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_sessions',
          filter,
        },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_urgencies',
          filter,
        },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_withdrawals',
          filter,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [adminSession, groupId, load]);

  async function updateUrgency(item: Urgency, status: Urgency['status']) {
    if (!supabase || !adminSession) return;
    setBusyId(item.id);
    const response = await supabase.rpc(
      'taggi_admin_set_inventory_urgency_status',
      {
        p_group_id: groupId,
        p_urgency_id: item.id,
        p_status: status,
        p_session_id: adminSession.id,
        p_session_token: adminSession.token,
      },
    );
    setBusyId('');
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    await load();
    onToast('Urgência atualizada.');
  }

  const filteredUrgencies = snapshot.urgencies.filter(
    (item) => urgencyFilter === 'all' || item.status === urgencyFilter,
  );
  const openUrgencies = snapshot.urgencies.filter(
    (item) => item.status === 'open' || item.status === 'ordered',
  ).length;

  return (
    <div className={active ? 'inventory-admin-page' : 'hidden'}>
      <section className="inventory-admin-summary">
        <article className="surface-panel">
          <span>
            <Bell className="size-5" />
          </span>
          <div>
            <small>Urgências ativas</small>
            <strong>{openUrgencies}</strong>
          </div>
        </article>
        <article className="surface-panel">
          <span>
            <ClipboardList className="size-5" />
          </span>
          <div>
            <small>Insumos finalizados</small>
            <strong>{snapshot.reports.length}</strong>
          </div>
        </article>
        <article className="surface-panel">
          <span>
            <PackageMinus className="size-5" />
          </span>
          <div>
            <small>Baixas recentes</small>
            <strong>{snapshot.withdrawals.length}</strong>
          </div>
        </article>
      </section>

      <div className="inventory-admin-grid">
        <section className="surface-panel inventory-admin-urgencies">
          <header>
            <div>
              <h2>Urgências recebidas</h2>
              <p>Itens enviados pela equipe para compra.</p>
            </div>
            <NativeSelect
              value={urgencyFilter}
              onChange={(event) =>
                setUrgencyFilter(
                  event.target.value as 'all' | Urgency['status'],
                )
              }
            >
              <NativeSelectOption value="all">
                Todos os status
              </NativeSelectOption>
              <NativeSelectOption value="open">Abertas</NativeSelectOption>
              <NativeSelectOption value="ordered">Em compra</NativeSelectOption>
              <NativeSelectOption value="resolved">
                Resolvidas
              </NativeSelectOption>
              <NativeSelectOption value="dismissed">
                Descartadas
              </NativeSelectOption>
            </NativeSelect>
          </header>
          <div className="inventory-admin-list">
            {filteredUrgencies.map((item) => (
              <article key={item.id}>
                <i
                  className={
                    item.status === 'open' || item.status === 'ordered'
                      ? 'active'
                      : ''
                  }
                />
                <span>
                  <strong>{item.productName}</strong>
                  <small>
                    {item.responsibleName ?? 'Equipe'} •{' '}
                    {dateTime(item.finalizedAt ?? item.createdAt)}
                  </small>
                </span>
                <b>{item.quantity} un.</b>
                <NativeSelect
                  aria-label={'Status de ' + item.productName}
                  value={item.status}
                  disabled={busyId === item.id}
                  onChange={(event) =>
                    void updateUrgency(
                      item,
                      event.target.value as Urgency['status'],
                    )
                  }
                >
                  <NativeSelectOption value="open">Aberta</NativeSelectOption>
                  <NativeSelectOption value="ordered">
                    Em compra
                  </NativeSelectOption>
                  <NativeSelectOption value="resolved">
                    Resolvida
                  </NativeSelectOption>
                  <NativeSelectOption value="dismissed">
                    Descartada
                  </NativeSelectOption>
                </NativeSelect>
              </article>
            ))}
            {!filteredUrgencies.length ? (
              <div className="inventory-empty compact">
                <Check className="size-5" />
                <p>Nenhuma urgência neste filtro.</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="surface-panel inventory-admin-reports">
          <header>
            <div>
              <h2>Relatórios de insumo</h2>
              <p>Contagens finalizadas com responsável e horário.</p>
            </div>
          </header>
          <div className="inventory-admin-list reports">
            {snapshot.reports.map((report) => {
              const expanded = expandedReport === report.id;
              return (
                <article className={expanded ? 'expanded' : ''} key={report.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedReport(expanded ? '' : report.id)}
                  >
                    <span>
                      <strong>{report.responsibleName}</strong>
                      <small>{dateTime(report.finalizedAt)}</small>
                    </span>
                    <b>{report.items.length} itens</b>
                    {report.urgentCount ? (
                      <em>{report.urgentCount} urgentes</em>
                    ) : null}
                    <ChevronRight className="size-4" />
                  </button>
                  {expanded ? (
                    <div>
                      {report.items.map((item) => (
                        <span key={item.productId}>
                          <i className={item.urgent ? 'urgent' : ''} />
                          <b>{item.productName}</b>
                          <small>{item.previousQuantity} anteriores</small>
                          <strong>{item.countedQuantity}</strong>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!snapshot.reports.length ? (
              <div className="inventory-empty compact">
                <ClipboardList className="size-5" />
                <p>Nenhum insumo foi finalizado.</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="surface-panel inventory-admin-withdrawals">
        <header>
          <div>
            <h2>Histórico de baixas</h2>
            <p>Movimentações mais recentes do estoque.</p>
          </div>
        </header>
        <div className="inventory-history-row head">
          <span>Data e hora</span>
          <span>Produto</span>
          <span>Quantidade</span>
          <span>Responsável</span>
        </div>
        {snapshot.withdrawals.map((item) => (
          <div className="inventory-history-row" key={item.id}>
            <span>{dateTime(item.createdAt)}</span>
            <strong>{item.productName}</strong>
            <span>
              -{item.quantity} • saldo {item.newQuantity}
            </span>
            <span>{item.responsibleName}</span>
          </div>
        ))}
        {!snapshot.withdrawals.length ? (
          <div className="inventory-empty compact">
            <PackageMinus className="size-5" />
            <p>Nenhuma baixa registrada.</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

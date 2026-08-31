'use client';

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Archive,
  Box,
  Check,
  ClipboardList,
  LoaderCircle,
  PackageMinus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { readableError } from '@/lib/taggi';
import { supabase } from '@/lib/supabase';

type Product = { id: string; name: string; quantity: number; status: string };
type InventorySession = {
  id: string;
  status: string;
  responsibleName: string;
  createdAt: string;
};
type Urgency = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  status: string;
  createdAt: string;
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
type Finalized = {
  id: string;
  responsibleName: string;
  finalizedAt: string;
  items: Array<{
    productId: string;
    productName: string;
    previousQuantity: number;
    countedQuantity: number;
  }>;
};
type Snapshot = {
  products: Product[];
  session: InventorySession | null;
  urgencies: Urgency[];
  withdrawals: Withdrawal[];
  lastFinalized: Finalized | null;
};

const emptySnapshot: Snapshot = {
  products: [],
  session: null,
  urgencies: [],
  withdrawals: [],
  lastFinalized: null,
};
const dateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));

export function InventoryPanel({
  groupId,
  active,
  adminSession,
  onToast,
}: {
  groupId: string;
  active: boolean;
  adminSession?: { id: string; token: string } | null;
  onToast: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editMode, setEditMode] = useState(false);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState('0');
  const [withdrawProductId, setWithdrawProductId] = useState('');
  const [withdrawQuantity, setWithdrawQuantity] = useState('1');
  const [urgentOpen, setUrgentOpen] = useState(false);
  const [urgentIds, setUrgentIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const visibleProducts = useMemo(
    () =>
      snapshot.products.filter((product) =>
        product.name
          .toLocaleLowerCase('pt-BR')
          .includes(search.toLocaleLowerCase('pt-BR')),
      ),
    [search, snapshot.products],
  );
  const selectedWithdrawal =
    snapshot.products.find((product) => product.id === withdrawProductId) ??
    snapshot.products[0];

  const loadSnapshot = useCallback(async () => {
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
    setCounts((current) =>
      Object.fromEntries(
        next.products.map((product) => [
          product.id,
          current[product.id] ?? product.quantity,
        ]),
      ),
    );
    if (!withdrawProductId && next.products[0])
      setWithdrawProductId(next.products[0].id);
  }, [groupId, onToast, withdrawProductId]);

  useEffect(() => {
    if (active) void loadSnapshot();
  }, [active, loadSnapshot]);
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const filter = 'group_id=eq.' + groupId;
    const channel = client
      .channel('taggi-inventory-ui-' + groupId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_products',
          filter,
        },
        () => void loadSnapshot(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_sessions',
          filter,
        },
        () => void loadSnapshot(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_urgencies',
          filter,
        },
        () => void loadSnapshot(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_inventory_withdrawals',
          filter,
        },
        () => void loadSnapshot(),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [groupId, loadSnapshot]);

  async function beginInventory() {
    if (!supabase) return;
    setBusy(true);
    const response = await supabase.rpc('taggi_inventory_begin', {
      p_group_id: groupId,
    });
    setBusy(false);
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    await loadSnapshot();
    onToast('Novo insumo iniciado.');
  }
  async function addProduct(event: FormEvent) {
    event.preventDefault();
    if (!supabase || newName.trim().length < 2) return;
    setBusy(true);
    const response = await supabase.rpc('taggi_inventory_save_product', {
      p_group_id: groupId,
      p_product_id: null,
      p_name: newName.trim(),
      p_initial_quantity: Math.max(0, Number(newQuantity) || 0),
    });
    setBusy(false);
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    setNewName('');
    setNewQuantity('0');
    await loadSnapshot();
    onToast('Produto adicionado à lista.');
  }
  async function renameProduct(product: Product, name: string) {
    if (!supabase || name.trim() === product.name) return;
    const response = await supabase.rpc('taggi_inventory_save_product', {
      p_group_id: groupId,
      p_product_id: product.id,
      p_name: name.trim(),
      p_initial_quantity: product.quantity,
    });
    if (response.error) onToast(readableError(response.error));
    else await loadSnapshot();
  }
  async function archiveProduct(product: Product) {
    if (!supabase) return;
    setBusy(true);
    const response = await supabase.rpc('taggi_inventory_archive_product', {
      p_group_id: groupId,
      p_product_id: product.id,
    });
    setBusy(false);
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    await loadSnapshot();
    onToast('Produto removido da lista ativa.');
  }
  async function finalizeInventory() {
    if (!supabase || !snapshot.session) return;
    setBusy(true);
    const response = await supabase.rpc('taggi_inventory_finalize', {
      p_group_id: groupId,
      p_session_id: snapshot.session.id,
      p_items: snapshot.products.map((product) => ({
        productId: product.id,
        quantity: Math.max(0, Number(counts[product.id] ?? 0)),
      })),
      p_urgent_product_ids: [...urgentIds],
    });
    setBusy(false);
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    setUrgentOpen(false);
    setUrgentIds(new Set());
    await loadSnapshot();
    onToast('Insumo concluído e relatório enviado à Administração.');
  }
  async function withdraw(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selectedWithdrawal) return;
    const quantity = Number(withdrawQuantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      onToast('Informe uma quantidade válida.');
      return;
    }
    setBusy(true);
    const response = await supabase.rpc('taggi_inventory_withdraw', {
      p_group_id: groupId,
      p_product_id: selectedWithdrawal.id,
      p_quantity: quantity,
    });
    setBusy(false);
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    setWithdrawQuantity('1');
    await loadSnapshot();
    onToast('Baixa registrada sem permitir estoque negativo.');
  }

  async function updateUrgency(item: Urgency, status: string) {
    if (!supabase || !adminSession) return;
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
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    await loadSnapshot();
    onToast('Urgência atualizada pela Administração.');
  }

  return (
    <div className={active ? 'inventory-page' : 'hidden'}>
      <div className="inventory-heading">
        <div>
          <h1>Insumos</h1>
          <p>
            Monte sua lista, finalize o insumo, marque urgências e acompanhe as
            baixas.
          </p>
        </div>
        {snapshot.session ? (
          <div className="inventory-session-state">
            <span />
            <b>Em edição</b>
          </div>
        ) : (
          <Button
            className="taggi-button-primary"
            onClick={() => void beginInventory()}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Iniciar novo insumo
          </Button>
        )}
      </div>

      <section className="surface-panel inventory-current">
        <div className="inventory-current-title">
          <span>
            <Box className="size-5" />
          </span>
          <div>
            <h2>
              {snapshot.session
                ? 'Insumo atual'
                : 'Lista permanente de produtos'}
            </h2>
            <p>
              {snapshot.session
                ? `Responsável: ${snapshot.session.responsibleName}`
                : 'Cadastre os produtos uma vez; as quantidades permanecem salvas.'}
            </p>
          </div>
        </div>
        <div className="inventory-current-actions">
          <Button
            variant="outline"
            className="taggi-button-subtle"
            onClick={() => setEditMode((value) => !value)}
          >
            {editMode ? 'Finalizar edição' : 'Editar lista'}
          </Button>
          {snapshot.session ? (
            <Button
              className="inventory-finish-button"
              onClick={() => setUrgentOpen(true)}
              disabled={!snapshot.products.length}
            >
              <Check className="size-4" />
              Concluir insumo
            </Button>
          ) : null}
        </div>
      </section>

      <div className="inventory-layout">
        <div className="inventory-main-column">
          <div className="inventory-top-grid">
            <section className="surface-panel inventory-products">
              <header>
                <div>
                  <h2>Itens do insumo</h2>
                  <p>{snapshot.products.length} produtos ativos</p>
                </div>
                <label>
                  <Search className="size-4" />
                  <input
                    placeholder="Pesquisar produto"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              </header>
              <div className="inventory-product-table">
                <div className="inventory-product-row head">
                  <span>Produto</span>
                  <span>
                    {snapshot.session
                      ? 'Quantidade contada'
                      : 'Quantidade atual'}
                  </span>
                  <span />
                </div>
                {visibleProducts.map((product) => (
                  <div className="inventory-product-row" key={product.id}>
                    {editMode ? (
                      <Input
                        defaultValue={product.name}
                        className="taggi-control h-9"
                        onBlur={(event) =>
                          void renameProduct(product, event.target.value)
                        }
                      />
                    ) : (
                      <strong>{product.name}</strong>
                    )}
                    {snapshot.session ? (
                      <Input
                        type="number"
                        min="0"
                        className="taggi-control h-9"
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
                      />
                    ) : (
                      <b>{product.quantity}</b>
                    )}
                    {editMode ? (
                      <button
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
                  <div className="inventory-empty">
                    <Archive className="size-6" />
                    <p>Nenhum produto cadastrado.</p>
                  </div>
                ) : null}
              </div>
              {editMode ? (
                <form className="inventory-add-product" onSubmit={addProduct}>
                  <Input
                    className="taggi-control"
                    placeholder="Nome do novo produto"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                  <Input
                    className="taggi-control"
                    type="number"
                    min="0"
                    placeholder="Quantidade inicial"
                    value={newQuantity}
                    onChange={(event) => setNewQuantity(event.target.value)}
                  />
                  <Button
                    className="taggi-button-primary"
                    disabled={busy || newName.trim().length < 2}
                  >
                    <Plus className="size-4" />
                    Adicionar item
                  </Button>
                </form>
              ) : null}
            </section>

            <section className="surface-panel inventory-urgencies">
              <header>
                <span>Após finalizar</span>
                <h2>Urgências para compra</h2>
                <p>
                  Os itens selecionados chegam à Administração com a quantidade
                  atual.
                </p>
              </header>
              <div>
                {snapshot.urgencies.map((item) => (
                  <article key={item.id}>
                    <ShoppingCart className="size-4" />
                    <span>
                      <strong>{item.productName}</strong>
                      <small>
                        {item.status === 'ordered'
                          ? 'Compra em andamento'
                          : 'Aguardando Administração'}
                      </small>
                    </span>
                    {adminSession ? (
                      <NativeSelect
                        value={item.status}
                        onChange={(event) =>
                          void updateUrgency(item, event.target.value)
                        }
                      >
                        <NativeSelectOption value="open">
                          Aberta
                        </NativeSelectOption>
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
                    ) : (
                      <b>{item.quantity}</b>
                    )}
                  </article>
                ))}
                {!snapshot.urgencies.length ? (
                  <div className="inventory-empty compact">
                    <ShoppingCart className="size-5" />
                    <p>Nenhuma urgência aberta.</p>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <section className="surface-panel inventory-withdraw">
            <header>
              <PackageMinus className="size-5" />
              <div>
                <h2>Dar baixa</h2>
                <p>Retire itens e envie o relatório para a Administração.</p>
              </div>
            </header>
            <form onSubmit={withdraw}>
              <NativeSelect
                value={selectedWithdrawal?.id ?? ''}
                onChange={(event) => setWithdrawProductId(event.target.value)}
              >
                <NativeSelectOption value="">
                  Selecione o produto
                </NativeSelectOption>
                {snapshot.products.map((product) => (
                  <NativeSelectOption key={product.id} value={product.id}>
                    {product.name} • {product.quantity} disponíveis
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Input
                className="taggi-control"
                type="number"
                min="1"
                max={selectedWithdrawal?.quantity ?? 1}
                value={withdrawQuantity}
                onChange={(event) => setWithdrawQuantity(event.target.value)}
              />
              <Button
                className="inventory-finish-button"
                disabled={busy || !selectedWithdrawal}
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  'Dar baixa'
                )}
              </Button>
            </form>
            <p className="inventory-note">
              A operação é atômica: duas pessoas não conseguem retirar o mesmo
              estoque ao mesmo tempo.
            </p>
          </section>

          <section className="surface-panel inventory-history">
            <header>
              <h2>Últimas baixas</h2>
              <span>Histórico auditável</span>
            </header>
            <div className="inventory-history-row head">
              <span>Data e hora</span>
              <span>Produto</span>
              <span>Quantidade</span>
              <span>Responsável</span>
            </div>
            {snapshot.withdrawals.slice(0, 8).map((item) => (
              <div className="inventory-history-row" key={item.id}>
                <span>{dateTime(item.createdAt)}</span>
                <strong>{item.productName}</strong>
                <span>
                  {item.quantity} {item.quantity === 1 ? 'unidade' : 'unidades'}
                </span>
                <span>{item.responsibleName}</span>
              </div>
            ))}
            {!snapshot.withdrawals.length ? (
              <div className="inventory-empty compact">
                <ClipboardList className="size-5" />
                <p>Nenhuma baixa registrada.</p>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="surface-panel inventory-report">
          <header>
            <span>
              <ClipboardList className="size-5" />
            </span>
            <div>
              <h2>Relatório da Administração</h2>
              <p>Atualizado em tempo real</p>
            </div>
          </header>
          {snapshot.lastFinalized ? (
            <section>
              <small>Último insumo concluído</small>
              <strong>{snapshot.lastFinalized.responsibleName}</strong>
              <p>{dateTime(snapshot.lastFinalized.finalizedAt)}</p>
              <div>
                {snapshot.lastFinalized.items.map((item) => (
                  <span key={item.productId}>
                    <b>{item.productName}</b>
                    <em>{item.countedQuantity}</em>
                  </span>
                ))}
              </div>
            </section>
          ) : (
            <div className="inventory-empty">
              <ClipboardList className="size-6" />
              <p>Conclua o primeiro insumo para gerar o relatório.</p>
            </div>
          )}
          <section>
            <small>Urgências recebidas</small>
            {snapshot.urgencies.map((item) => (
              <span key={item.id}>
                <b>{item.productName}</b>
                <em>{item.quantity}</em>
              </span>
            ))}
            {!snapshot.urgencies.length ? (
              <p className="inventory-report-muted">Sem urgências abertas.</p>
            ) : null}
          </section>
        </aside>
      </div>

      <Dialog open={urgentOpen} onOpenChange={setUrgentOpen}>
        <DialogContent className="taggi-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Urgências para compra</DialogTitle>
            <DialogDescription>
              Marque os itens que precisam ser comprados. A contagem será
              finalizada e enviada à Administração.
            </DialogDescription>
          </DialogHeader>
          <div className="inventory-urgent-dialog">
            {snapshot.products.map((product) => (
              <label key={product.id}>
                <input
                  type="checkbox"
                  checked={urgentIds.has(product.id)}
                  onChange={(event) =>
                    setUrgentIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(product.id);
                      else next.delete(product.id);
                      return next;
                    })
                  }
                />
                <span>
                  <strong>{product.name}</strong>
                  <small>
                    Quantidade contada: {counts[product.id] ?? product.quantity}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="taggi-button-subtle"
              onClick={() => setUrgentOpen(false)}
            >
              Voltar
            </Button>
            <Button
              className="inventory-finish-button"
              onClick={() => void finalizeInventory()}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Finalizar e enviar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

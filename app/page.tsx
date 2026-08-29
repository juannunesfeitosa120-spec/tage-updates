"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive, BarChart3, Bell, Boxes, CheckCircle2, ChevronRight, Clock3,
  History, Home, LockKeyhole, MessageSquareText, Moon, PackageCheck,
  Plus, Search, Settings, ShieldCheck, ShoppingBag, Sparkles, Sun,
  Tag, UserRound, XCircle,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";

type View = "inicio" | "lancamento" | "historico" | "chat" | "admin";
type Platform = { id: string; name: string; short: string; count: number; tone: string };
type Activity = { id: number; platform: string; amount: number; time: string; person: string };

const initialPlatforms: Platform[] = [
  { id: "ml-flex", name: "Mercado Livre Flex", short: "ML", count: 38, tone: "#ffe600" },
  { id: "shopee-direta", name: "Shopee Direta", short: "SH", count: 27, tone: "#ff5a1f" },
  { id: "ml-coleta", name: "Mercado Livre Coleta", short: "ML", count: 41, tone: "#ffe600" },
  { id: "shopee-coleta", name: "Shopee Coleta", short: "SH", count: 22, tone: "#ff5a1f" },
  { id: "shein-coleta", name: "Shein Coleta", short: "SN", count: 16, tone: "#f4f4f5" },
];

const initialActivities: Activity[] = [
  { id: 1, platform: "Mercado Livre Coleta", amount: 12, time: "há 8 min", person: "Juan" },
  { id: 2, platform: "Shopee Direta", amount: 8, time: "há 22 min", person: "Leandra" },
  { id: 3, platform: "Mercado Livre Flex", amount: 15, time: "há 41 min", person: "Juan" },
  { id: 4, platform: "Shein Coleta", amount: 6, time: "há 1h", person: "Equipe" },
];

const navItems = [
  { id: "inicio" as View, label: "Início", icon: Home },
  { id: "lancamento" as View, label: "Lançamento", icon: Plus },
  { id: "historico" as View, label: "Histórico", icon: History },
  { id: "chat" as View, label: "Chat da equipe", icon: MessageSquareText },
  { id: "admin" as View, label: "Administração", icon: ShieldCheck },
];

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><Tag className="size-4" strokeWidth={2.2} /></div>;
}

function timeNow() {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

export default function HomePage() {
  const [view, setView] = useState<View>("inicio");
  const [platforms, setPlatforms] = useState(initialPlatforms);
  const [activities, setActivities] = useState(initialActivities);
  const [dark, setDark] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState(initialPlatforms[0].id);
  const [quantity, setQuantity] = useState("1");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [storedPassword, setStoredPassword] = useState(() =>
    typeof window === "undefined" ? "" : window.localStorage.getItem("taggi-admin-password") ?? ""
  );
  const total = useMemo(() => platforms.reduce((sum, item) => sum + item.count, 0), [platforms]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  function addLabels() {
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount < 1) { toast.error("Informe uma quantidade válida."); return; }
    const selected = platforms.find((item) => item.id === selectedPlatform)!;
    setPlatforms((items) => items.map((item) => item.id === selectedPlatform ? { ...item, count: item.count + amount } : item));
    setActivities((items) => [{ id: Date.now(), platform: selected.name, amount, time: `agora, ${timeNow()}`, person: "Juan" }, ...items].slice(0, 8));
    setLaunchOpen(false); setQuantity("1");
    toast.success(`${amount} etiqueta${amount > 1 ? "s" : ""} adicionada${amount > 1 ? "s" : ""}.`);
  }

  function unlockAdmin() {
    if (!adminPassword.trim()) return;
    if (!storedPassword) {
      window.localStorage.setItem("taggi-admin-password", adminPassword);
      setStoredPassword(adminPassword); setAdminUnlocked(true); toast.success("Senha administrativa criada.");
    } else if (adminPassword === storedPassword) { setAdminUnlocked(true); toast.success("Acesso liberado."); }
    else toast.error("Senha incorreta.");
    setAdminPassword("");
  }

  const openLaunch = (platformId?: string) => { if (platformId) setSelectedPlatform(platformId); setLaunchOpen(true); };

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="offcanvas" className="taggi-sidebar border-r-0">
        <SidebarHeader className="p-5"><div className="flex items-center gap-3"><BrandMark /><div><p className="text-base font-semibold tracking-tight">Taggi</p><p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Operação inteligente</p></div></div></SidebarHeader>
        <SidebarContent className="px-3 py-3"><SidebarGroup><SidebarGroupContent><SidebarMenu className="gap-1.5">
          {navItems.map((item) => <SidebarMenuItem key={item.id}><SidebarMenuButton isActive={view === item.id} onClick={() => setView(item.id)} tooltip={item.label} className="h-11 rounded-xl px-3 text-sm data-[active=true]:bg-white/10 data-[active=true]:text-white"><item.icon className="size-[18px]" /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}
        </SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent>
        <SidebarFooter className="gap-1 p-3">
          <button onClick={() => setFeedbackOpen(true)} className="sidebar-utility"><MessageSquareText className="size-4" /><span>Feedback</span></button>
          <button onClick={() => setSettingsOpen(true)} className="sidebar-utility"><Settings className="size-4" /><span>Configurações</span></button>
          <div className="mt-2 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.035] p-3"><div className="grid size-9 place-items-center rounded-xl bg-white/10"><UserRound className="size-4" /></div><div className="min-w-0"><p className="truncate text-xs font-medium">Juan Nunes</p><p className="text-[10px] text-muted-foreground">Administrador</p></div></div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-transparent">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/[0.06] bg-[#08090b]/80 px-4 backdrop-blur-xl sm:px-7">
          <div className="flex items-center gap-3"><SidebarTrigger className="md:hidden" /><div><p className="text-xs text-muted-foreground">Sábado, 29 de agosto</p><h1 className="text-sm font-semibold sm:text-base">{navItems.find((item) => item.id === view)?.label}</h1></div></div>
          <div className="flex items-center gap-2"><button className="icon-button" aria-label="Notificações"><Bell className="size-4" /><span className="notification-dot" /></button><button className="icon-button" aria-label="Alternar tema" onClick={() => setDark((value) => !value)}>{dark ? <Sun className="size-4" /> : <Moon className="size-4" />}</button><Button onClick={() => openLaunch()} className="ml-1 h-9 rounded-xl bg-white px-4 text-xs font-semibold text-black hover:bg-zinc-200"><Plus className="mr-1.5 size-4" />Novo lançamento</Button></div>
        </header>

        <main className="p-4 sm:p-7 lg:p-9">
          {view === "inicio" && <div className="mx-auto max-w-[1420px] space-y-6">
            <section className="hero-panel"><div className="relative z-10"><div className="mb-8 flex items-center gap-2 text-xs text-zinc-400"><span className="live-dot" />Operação em tempo real</div><p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Total do dia</p><div className="mt-2 flex items-end gap-3"><strong className="total-number">{total}</strong><span className="mb-2 text-sm text-zinc-400">etiquetas</span></div><div className="mt-7 flex flex-wrap items-center gap-3"><Button onClick={() => openLaunch()} className="h-10 rounded-xl bg-white text-black hover:bg-zinc-200"><Plus className="mr-2 size-4" />Adicionar etiquetas</Button><span className="text-xs text-zinc-500">Meta diária: 220</span></div></div><div className="relative z-10 hidden w-72 lg:block"><div className="mb-3 flex items-center justify-between text-xs"><span className="text-zinc-400">Progresso da operação</span><span className="text-zinc-200">{Math.round((total / 220) * 100)}%</span></div><Progress value={(total / 220) * 100} className="h-2 bg-white/10" /><div className="mt-6 grid grid-cols-2 gap-3"><div className="mini-metric"><span>Última hora</span><strong>+26</strong></div><div className="mini-metric"><span>Ocorrências</span><strong>3</strong></div></div></div></section>
            <section><div className="mb-4 flex items-end justify-between"><div><h2 className="section-title">Contagem por plataforma</h2><p className="mt-1 text-xs text-muted-foreground">Acompanhe e atualize cada fluxo da operação.</p></div><button className="text-xs text-zinc-400 hover:text-white" onClick={() => setView("historico")}>Ver histórico <ChevronRight className="inline size-3.5" /></button></div><div className="platform-grid">{platforms.map((platform) => <article className="platform-card" key={platform.id}><div className="flex items-start justify-between"><span className="platform-badge" style={{ background: platform.tone, color: "#050505" }}>{platform.short}</span><button className="quick-plus" onClick={() => openLaunch(platform.id)} aria-label={`Adicionar em ${platform.name}`}><Plus className="size-4" /></button></div><p className="mt-7 min-h-9 text-sm font-medium leading-5">{platform.name}</p><div className="mt-3 flex items-end justify-between"><strong className="platform-number">{platform.count}</strong><span className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">hoje</span></div></article>)}</div></section>
            <section className="grid gap-5 xl:grid-cols-[1.45fr_.8fr]"><div className="surface-panel"><div className="flex items-center justify-between"><div><h2 className="section-title">Atividades recentes</h2><p className="mt-1 text-xs text-muted-foreground">Últimos lançamentos registrados pela equipe.</p></div><Clock3 className="size-4 text-zinc-500" /></div><div className="mt-5 divide-y divide-white/[0.06]">{activities.slice(0, 4).map((activity) => <div key={activity.id} className="activity-row"><div className="grid size-9 place-items-center rounded-xl bg-white/[0.055]"><PackageCheck className="size-4 text-zinc-300" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium sm:text-sm">{activity.platform}</p><p className="mt-0.5 text-[11px] text-zinc-500">{activity.person} · {activity.time}</p></div><span className="rounded-lg bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">+{activity.amount}</span></div>)}</div></div><div className="surface-panel"><div className="flex items-center justify-between"><div><h2 className="section-title">Saúde da operação</h2><p className="mt-1 text-xs text-muted-foreground">Resumo das etiquetas processadas.</p></div><BarChart3 className="size-4 text-zinc-500" /></div><div className="mt-6 space-y-4"><div className="health-row"><CheckCircle2 className="size-4 text-emerald-400" /><span>Processadas</span><strong>{total - 3}</strong></div><div className="health-row"><XCircle className="size-4 text-rose-400" /><span>Com ocorrência</span><strong>3</strong></div><div className="health-row"><Archive className="size-4 text-sky-400" /><span>Produtos expedidos</span><strong>128</strong></div></div></div></section>
          </div>}
          {view === "lancamento" && <LaunchView platforms={platforms} onLaunch={openLaunch} />}
          {view === "historico" && <HistoryView activities={activities} total={total} />}
          {view === "chat" && <ChatView />}
          {view === "admin" && <AdminView unlocked={adminUnlocked} storedPassword={storedPassword} password={adminPassword} setPassword={setAdminPassword} onUnlock={unlockAdmin} total={total} />}
        </main>
      </SidebarInset>

      <Dialog open={launchOpen} onOpenChange={setLaunchOpen}><DialogContent className="border-white/10 bg-[#111317] text-white sm:max-w-md"><DialogHeader><DialogTitle>Novo lançamento</DialogTitle><DialogDescription>Registre as etiquetas contabilizadas nesta operação.</DialogDescription></DialogHeader><div className="space-y-5 py-3"><div><label className="field-label">Plataforma</label><div className="grid gap-2">{platforms.map((item) => <button key={item.id} onClick={() => setSelectedPlatform(item.id)} className={`platform-option ${selectedPlatform === item.id ? "selected" : ""}`}><span>{item.name}</span>{selectedPlatform === item.id && <CheckCircle2 className="size-4" />}</button>)}</div></div><div><label className="field-label" htmlFor="quantity">Quantidade</label><Input id="quantity" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="h-12 rounded-xl border-white/10 bg-white/[0.04] text-lg" /></div></div><DialogFooter><Button variant="ghost" onClick={() => setLaunchOpen(false)}>Cancelar</Button><Button onClick={addLabels} className="bg-white text-black hover:bg-zinc-200">Registrar etiquetas</Button></DialogFooter></DialogContent></Dialog>
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}><SheetContent className="border-white/10 bg-[#101216] text-white sm:max-w-md"><SheetHeader><SheetTitle>Configurações</SheetTitle><SheetDescription>Personalize sua experiência no Taggi.</SheetDescription></SheetHeader><div className="space-y-3 p-4"><div className="setting-row"><div><p className="text-sm font-medium">Tema escuro</p><p className="text-xs text-zinc-500">Interface com contraste suave.</p></div><Switch checked={dark} onCheckedChange={setDark} /></div><div className="setting-row"><div><p className="text-sm font-medium">Notificações</p><p className="text-xs text-zinc-500">Alertas sobre metas e ocorrências.</p></div><Switch defaultChecked /></div><div className="rounded-2xl border border-white/[0.07] p-4"><p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Sobre</p><p className="mt-3 text-sm font-medium">Taggi · Versão web</p><p className="mt-1 text-xs text-zinc-500">Desenvolvido por Juan Nunes</p></div></div></SheetContent></Sheet>
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}><DialogContent className="border-white/10 bg-[#111317] text-white sm:max-w-md"><DialogHeader><DialogTitle>Enviar feedback</DialogTitle><DialogDescription>Conte o que pode deixar o Taggi ainda melhor.</DialogDescription></DialogHeader><textarea className="min-h-32 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm outline-none focus:border-white/25" placeholder="Escreva sua sugestão..." /><DialogFooter><Button onClick={() => { setFeedbackOpen(false); toast.success("Feedback registrado. Obrigado!"); }} className="bg-white text-black hover:bg-zinc-200">Enviar feedback</Button></DialogFooter></DialogContent></Dialog>
      <Toaster theme={dark ? "dark" : "light"} position="top-right" richColors />
    </SidebarProvider>
  );
}

function LaunchView({ platforms, onLaunch }: { platforms: Platform[]; onLaunch: (id?: string) => void }) {
  return <div className="view-wrap"><div className="view-heading"><p>Operação</p><h2>O que você quer contabilizar?</h2><span>Escolha uma plataforma para fazer um lançamento rápido.</span></div><div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{platforms.map((item) => <button key={item.id} onClick={() => onLaunch(item.id)} className="large-action-card"><span className="platform-badge" style={{ background: item.tone, color: "#090909" }}>{item.short}</span><div><p>{item.name}</p><span>{item.count} etiquetas hoje</span></div><Plus className="ml-auto size-5 text-zinc-500" /></button>)}</div></div>;
}

function HistoryView({ activities, total }: { activities: Activity[]; total: number }) {
  return <div className="view-wrap"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div className="view-heading"><p>Últimos 30 dias</p><h2>Histórico da operação</h2><span>Consulte registros e acompanhe a evolução diária.</span></div><div className="relative"><Search className="absolute left-3 top-3 size-4 text-zinc-500" /><Input placeholder="Buscar registro" className="h-10 w-full rounded-xl border-white/10 bg-white/[0.035] pl-10 sm:w-64" /></div></div><div className="mt-7 grid gap-4 sm:grid-cols-3"><div className="summary-card"><span>Hoje</span><strong>{total}</strong></div><div className="summary-card"><span>Últimos 7 dias</span><strong>946</strong></div><div className="summary-card"><span>Média diária</span><strong>135</strong></div></div><div className="surface-panel mt-5"><div className="divide-y divide-white/[0.06]">{activities.map((item) => <div className="activity-row" key={item.id}><div className="grid size-9 place-items-center rounded-xl bg-white/[0.055]"><Boxes className="size-4" /></div><div className="flex-1"><p className="text-sm font-medium">{item.platform}</p><p className="text-[11px] text-zinc-500">{item.person} · {item.time}</p></div><strong className="text-sm text-emerald-300">+{item.amount}</strong></div>)}</div></div></div>;
}

function ChatView() {
  return <div className="view-wrap"><div className="view-heading"><p>Equipe online</p><h2>Chat da operação</h2><span>Centralize avisos rápidos durante a expedição.</span></div><div className="mt-7 grid min-h-[520px] overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.025] lg:grid-cols-[240px_1fr]"><aside className="border-b border-white/[0.07] p-4 lg:border-b-0 lg:border-r"><p className="px-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Conversas</p>{["Operação geral", "Ocorrências", "Coleta da tarde"].map((name, i) => <button key={name} className={`mt-2 flex w-full items-center gap-3 rounded-xl p-3 text-left ${i === 0 ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}><span className="grid size-8 place-items-center rounded-lg bg-white/10"><ShoppingBag className="size-3.5" /></span><span className="text-xs">{name}</span></button>)}</aside><div className="flex flex-col p-5"><div className="flex-1 space-y-4"><div className="message-bubble"><strong>Leandra</strong><p>Coleta da Shopee conferida. Tudo certo por aqui.</p><span>14:18</span></div><div className="message-bubble self-message"><strong>Você</strong><p>Perfeito! Vou fechar o Mercado Livre agora.</p><span>14:21</span></div></div><div className="mt-6 flex gap-2"><Input placeholder="Escreva uma mensagem..." className="h-11 rounded-xl border-white/10 bg-white/[0.035]" /><Button onClick={() => toast.success("Mensagem enviada.")} className="h-11 rounded-xl bg-white text-black">Enviar</Button></div></div></div></div>;
}

function AdminView({ unlocked, storedPassword, password, setPassword, onUnlock, total }: { unlocked: boolean; storedPassword: string; password: string; setPassword: (value: string) => void; onUnlock: () => void; total: number }) {
  if (!unlocked) return <div className="mx-auto grid min-h-[68vh] max-w-md place-items-center"><div className="w-full rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-7 text-center shadow-2xl"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/[0.07]"><LockKeyhole className="size-6" /></div><h2 className="mt-5 text-xl font-semibold">Área protegida</h2><p className="mt-2 text-sm leading-6 text-zinc-500">{storedPassword ? "Digite sua senha administrativa para continuar." : "Crie a senha que protegerá os dados de gestão neste dispositivo."}</p><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onUnlock()} placeholder={storedPassword ? "Sua senha" : "Crie uma senha"} className="mt-6 h-12 rounded-xl border-white/10 bg-white/[0.04] text-center" /><Button onClick={onUnlock} className="mt-3 h-11 w-full rounded-xl bg-white text-black hover:bg-zinc-200">{storedPassword ? "Entrar" : "Criar senha e entrar"}</Button><p className="mt-4 text-[10px] text-zinc-600">A senha fica salva apenas neste navegador.</p></div></div>;
  const performance: Array<[string, number]> = [["Juan", 92], ["Leandra", 86], ["Equipe", 74]];
  return <div className="view-wrap"><div className="view-heading"><p>Visão administrativa</p><h2>Controle da operação</h2><span>Indicadores reservados para gestão, RH e responsáveis.</span></div><div className="mt-7 grid gap-4 md:grid-cols-3"><div className="summary-card"><span>Etiquetas processadas</span><strong>{total}</strong></div><div className="summary-card"><span>Eficiência estimada</span><strong>94%</strong></div><div className="summary-card"><span>Equipe ativa</span><strong>4</strong></div></div><div className="mt-5 grid gap-5 lg:grid-cols-2"><div className="surface-panel"><h3 className="section-title">Desempenho por pessoa</h3><div className="mt-5 space-y-4">{performance.map(([name, value]) => <div key={name}><div className="mb-2 flex justify-between text-xs"><span>{name}</span><span className="text-zinc-500">{value}%</span></div><Progress value={value} className="h-1.5 bg-white/10" /></div>)}</div></div><div className="surface-panel"><h3 className="section-title">Alertas de gestão</h3><div className="mt-5 space-y-3"><div className="health-row"><Sparkles className="size-4 text-amber-300" /><span>Meta diária em andamento</span><strong>{Math.round((total/220)*100)}%</strong></div><div className="health-row"><XCircle className="size-4 text-rose-400" /><span>Ocorrências pendentes</span><strong>3</strong></div></div></div></div></div>;
}

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
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Download,
  File,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  Users,
  X,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { readableError } from '@/lib/taggi';
import { supabase } from '@/lib/supabase';

type ChatMember = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  lastSeenAt: string;
};
type Conversation = {
  id: string;
  type: 'group' | 'private';
  title: string;
  other?: ChatMember;
  updatedAt: string;
  unread: number;
};
type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  type: string;
  content: string;
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentSize: number | null;
  attachmentMime: string | null;
  attachmentUrl: string | null;
  replyTo: string | null;
  createdAt: string;
  pending?: boolean;
  failed?: boolean;
};
const CHAT_BUCKET = 'taggi-chat';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isPersistedMessageId = (
  value: string | null | undefined,
): value is string => Boolean(value && UUID_PATTERN.test(value));
const formatTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const formatSize = (value: number | null) =>
  value == null
    ? ''
    : value < 1024
      ? `${value} B`
      : value < 1048576
        ? `${(value / 1024).toFixed(1)} KB`
        : `${(value / 1048576).toFixed(1)} MB`;
const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
const isImageAttachment = (
  message: Pick<ChatMessage, 'type' | 'attachmentMime'>,
) => message.type === 'image' || message.attachmentMime?.startsWith('image/');

function PendingFilePreview({ file }: { file: File }) {
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      return;
    }
    let active = true;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (active && typeof reader.result === 'string') {
        setPreviewUrl(reader.result);
      }
    });
    reader.readAsDataURL(file);
    return () => {
      active = false;
      reader.abort();
    };
  }, [file]);

  return previewUrl ? (
    <div className="chat-image-preview">
      {/* oxlint-disable-next-line nextjs/no-img-element */}
      <img src={previewUrl} alt={'Prévia de ' + file.name} />
      <div>
        <strong>{file.name}</strong>
        <small>{formatSize(file.size)}</small>
      </div>
    </div>
  ) : (
    <div className="chat-file-preview">
      <span>
        <File className="size-6" />
      </span>
      <div>
        <strong>{file.name}</strong>
        <small>{formatSize(file.size)}</small>
      </div>
    </div>
  );
}

export function ChatPanel({
  groupId,
  userId,
  members,
  groupName,
  noticeSeen,
  active,
  refreshMemberships,
  onToast,
}: {
  groupId: string;
  userId: string;
  members: ChatMember[];
  groupName: string;
  noticeSeen: boolean;
  active: boolean;
  refreshMemberships: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [readMessageIds, setReadMessageIds] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [conversationSearch, setConversationSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(!noticeSeen);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessages, setNewMessages] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const selectedIdRef = useRef('');

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members],
  );
  const conversationsRef = useRef<Conversation[]>([]);
  const memberMapRef = useRef(memberMap);
  const refreshMembershipsRef = useRef(refreshMemberships);
  const selected =
    conversations.find((c) => c.id === selectedId) ?? conversations[0];
  const visibleConversations = conversations.filter((c) =>
    `${c.title} ${c.other?.displayName ?? ''}`
      .toLocaleLowerCase('pt-BR')
      .includes(conversationSearch.toLocaleLowerCase('pt-BR')),
  );
  const visibleMessages = messageSearch.trim()
    ? messages.filter((m) =>
        m.content
          .toLocaleLowerCase('pt-BR')
          .includes(messageSearch.toLocaleLowerCase('pt-BR')),
      )
    : messages;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  useEffect(() => {
    memberMapRef.current = memberMap;
  }, [memberMap]);
  useEffect(() => {
    refreshMembershipsRef.current = refreshMemberships;
  }, [refreshMemberships]);

  const loadConversations = useCallback(async () => {
    if (!supabase) return;
    const result = await supabase
      .from('taggi_chat_conversations')
      .select('id,type,title,updated_at')
      .eq('group_id', groupId)
      .order('updated_at', { ascending: false });
    if (result.error) {
      onToast(readableError(result.error));
      return;
    }
    const ids = (result.data ?? []).map((item) => item.id);
    const membership = ids.length
      ? await supabase
          .from('taggi_chat_conversation_members')
          .select('conversation_id,user_id')
          .in('conversation_id', ids)
      : { data: [], error: null };
    const privateOther = new Map<string, ChatMember>();
    for (const item of membership.data ?? []) {
      if (item.user_id !== userId) {
        const member = memberMapRef.current.get(item.user_id);
        if (member) privateOther.set(item.conversation_id, member);
      }
    }
    const next = (result.data ?? []).map((item) => ({
      id: item.id,
      type: item.type as 'group' | 'private',
      title:
        item.type === 'group'
          ? 'Grupo'
          : (privateOther.get(item.id)?.displayName ?? 'Conversa'),
      other: privateOther.get(item.id),
      updatedAt: item.updated_at,
      unread: 0,
    }));
    setConversations(next);
    if (!selectedIdRef.current && next[0])
      setSelectedId(next.find((c) => c.type === 'group')?.id ?? next[0].id);
  }, [groupId, onToast, userId]);

  const loadMessages = useCallback(
    async (conversationId: string, before?: string) => {
      if (!supabase || !conversationId) return;
      let query = supabase
        .from('taggi_chat_messages')
        .select(
          'id,conversation_id,sender_user_id,message_type,content,attachment_path,attachment_name,attachment_size,attachment_mime,reply_to_message_id,created_at',
        )
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50);
      if (before) query = query.lt('created_at', before);
      const result = await query;
      if (result.error) {
        onToast(readableError(result.error));
        return;
      }
      const rows = [...(result.data ?? [])].reverse();
      const imagePaths = rows.flatMap((item) =>
        item.attachment_path &&
        (item.message_type === 'image' ||
          item.attachment_mime?.startsWith('image/'))
          ? [item.attachment_path]
          : [],
      );
      const signedResult = imagePaths.length
        ? await supabase.storage
            .from(CHAT_BUCKET)
            .createSignedUrls(imagePaths, 3600)
        : { data: [], error: null };
      const signedUrlByPath = new Map(
        (signedResult.data ?? []).flatMap((item) =>
          item.path && item.signedUrl ? [[item.path, item.signedUrl]] : [],
        ),
      );
      const next: ChatMessage[] = rows.map((item) => ({
        id: item.id,
        conversationId: item.conversation_id,
        senderId: item.sender_user_id,
        type: item.message_type,
        content: item.content,
        attachmentPath: item.attachment_path,
        attachmentName: item.attachment_name,
        attachmentSize: item.attachment_size,
        attachmentMime: item.attachment_mime,
        attachmentUrl: item.attachment_path
          ? (signedUrlByPath.get(item.attachment_path) ?? null)
          : null,
        replyTo: item.reply_to_message_id,
        createdAt: item.created_at,
      }));
      setHasOlder((result.data ?? []).length === 50);
      setMessages((current) =>
        before
          ? [
              ...next,
              ...current.filter(
                (item) => item.conversationId === conversationId,
              ),
            ]
          : next,
      );
      const ids = next.map((item) => item.id);
      if (ids.length) {
        const readResult = await supabase
          .from('taggi_chat_reads')
          .select('message_id,user_id')
          .in('message_id', ids);
        const alreadyReadByCurrentUser = new Set(
          (readResult.data ?? [])
            .filter((item) => item.user_id === userId)
            .map((item) => item.message_id),
        );
        setReadMessageIds(
          new Set(
            (readResult.data ?? [])
              .filter((r) => r.user_id !== userId)
              .map((r) => r.message_id),
          ),
        );
        const unread = next
          .filter(
            (item) =>
              item.senderId !== userId &&
              !alreadyReadByCurrentUser.has(item.id),
          )
          .map((item) => ({
            message_id: item.id,
            user_id: userId,
            read_at: new Date().toISOString(),
          }));
        if (unread.length)
          await supabase
            .from('taggi_chat_reads')
            .upsert(unread, { onConflict: 'message_id,user_id' });
      }
      setLoading(false);
    },
    [onToast, userId],
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);
  useEffect(() => {
    if (!selected?.id) return;
    setLoading(true);
    setNewMessages(0);
    void loadMessages(selected.id);
  }, [loadMessages, selected?.id]);
  useEffect(() => {
    if (!active || loading || !listRef.current) return;
    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [active, loading, selectedId]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const filter = 'group_id=eq.' + groupId;
    const channel = client
      .channel('taggi-chat-ui-' + groupId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'taggi_chat_messages',
          filter,
        },
        (payload) => {
          const row = payload.new as {
            conversation_id: string;
            sender_user_id: string;
            content: string;
            message_type: string;
          };
          if (row.sender_user_id !== userId) {
            const author =
              memberMapRef.current.get(row.sender_user_id)?.displayName ??
              'Equipe';
            const conversation = conversationsRef.current.find(
              (item) => item.id === row.conversation_id,
            );
            const title =
              conversation?.type === 'group' ? `${author} • Grupo` : author;
            const body =
              row.message_type === 'text'
                ? row.content.trim() || 'Enviou uma mensagem'
                : row.message_type === 'image'
                  ? 'Enviou uma imagem'
                  : 'Enviou um arquivo';
            onToast(`${title}: ${body.slice(0, 160)}`);
            void window.taggiDesktop?.showNotification?.({
              title,
              body,
            });
          }
          void loadConversations();
          if (row.conversation_id === selectedIdRef.current) {
            void loadMessages(row.conversation_id);
            if (!atBottomRef.current) setNewMessages((value) => value + 1);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'taggi_chat_reads' },
        (payload) => {
          const row = payload.new as {
            message_id?: string;
            user_id?: string;
          };
          if (row.message_id && row.user_id && row.user_id !== userId) {
            setReadMessageIds((current) => {
              const next = new Set(current);
              next.add(row.message_id!);
              return next;
            });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'taggi_user_presence', filter },
        () => void refreshMembershipsRef.current(),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [
    groupId,
    loadConversations,
    loadMessages,
    onToast,
    userId,
  ]);

  useEffect(() => {
    if (!supabase) return;
    const touch = () =>
      supabase!.rpc('taggi_touch_chat_presence', {
        p_group_id: groupId,
        p_online: true,
      });
    void touch();
    const timer = window.setInterval(touch, 60000);
    const offline = () => {
      void supabase?.rpc('taggi_touch_chat_presence', {
        p_group_id: groupId,
        p_online: false,
      });
    };
    window.addEventListener('beforeunload', offline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', offline);
      offline();
    };
  }, [groupId]);

  async function choosePrivate(member: ChatMember) {
    if (!supabase) return;
    const existing = conversations.find(
      (c) => c.type === 'private' && c.other?.userId === member.userId,
    );
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    const response = await supabase.rpc('taggi_start_private_chat', {
      p_group_id: groupId,
      p_other_user_id: member.userId,
    });
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    await loadConversations();
    setSelectedId(String(response.data));
  }

  async function uploadAttachment(file: File, conversationId: string) {
    if (!supabase) throw new Error('Sem conexão.');
    if (file.size > 25 * 1024 * 1024)
      throw new Error('O arquivo deve ter no máximo 25 MB.');
    const safe = file.name
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(-120);
    const path = `${groupId}/${conversationId}/${userId}/${crypto.randomUUID()}-${safe}`;
    const result = await supabase.storage.from(CHAT_BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });
    if (result.error) throw result.error;
    return path;
  }

  async function sendMessage(event?: FormEvent, retry?: ChatMessage) {
    event?.preventDefault();
    if (!supabase || !selected || sending) return;
    const body = (retry?.content ?? text).trim();
    const file = retry ? null : pendingFile;
    if (!body && !file) return;
    const replyTarget = retry?.replyTo ?? replyTo?.id;
    const temporary: ChatMessage = {
      id: 'temp-' + crypto.randomUUID(),
      conversationId: selected.id,
      senderId: userId,
      type: file ? (file.type.startsWith('image/') ? 'image' : 'file') : 'text',
      content: body,
      attachmentPath: null,
      attachmentName: file?.name ?? null,
      attachmentSize: file?.size ?? null,
      attachmentMime: file?.type ?? null,
      attachmentUrl: null,
      replyTo: isPersistedMessageId(replyTarget) ? replyTarget : null,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((current) => [
      ...current.filter((item) => item.id !== retry?.id),
      temporary,
    ]);
    setText('');
    setPendingFile(null);
    setReplyTo(null);
    setSending(true);
    let path = '';
    try {
      if (file) path = await uploadAttachment(file, selected.id);
      const response = await supabase
        .from('taggi_chat_messages')
        .insert({
          group_id: groupId,
          conversation_id: selected.id,
          sender_user_id: userId,
          message_type: temporary.type,
          content: body,
          attachment_path: path || null,
          attachment_name: file?.name ?? null,
          attachment_size: file?.size ?? null,
          attachment_mime: file?.type ?? null,
          reply_to_message_id: temporary.replyTo,
        })
        .select('id')
        .single();
      if (response.error) throw response.error;
      await loadMessages(selected.id);
      window.requestAnimationFrame(() =>
        listRef.current?.scrollTo({
          top: listRef.current.scrollHeight,
          behavior: 'smooth',
        }),
      );
    } catch (error) {
      if (path) await supabase.storage.from(CHAT_BUCKET).remove([path]);
      setMessages((current) =>
        current.map((item) =>
          item.id === temporary.id
            ? { ...item, pending: false, failed: true }
            : item,
        ),
      );
      onToast(readableError(error, 'Não foi possível enviar.'));
    } finally {
      setSending(false);
    }
  }

  function handleInputKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }
  async function acknowledgeNotice() {
    if (!supabase) return;
    const response = await supabase.rpc('taggi_acknowledge_chat_retention', {
      p_group_id: groupId,
    });
    if (response.error) {
      onToast(readableError(response.error));
      return;
    }
    setNoticeOpen(false);
    await refreshMemberships();
  }
  function onScroll() {
    const element = listRef.current;
    if (!element) return;
    atBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 72;
    if (atBottomRef.current) setNewMessages(0);
  }
  function scrollLatest() {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    });
    setNewMessages(0);
  }

  async function openAttachment(message: ChatMessage) {
    if (!supabase || !message.attachmentPath) return;
    if (isImageAttachment(message) && message.attachmentUrl) {
      window.open(message.attachmentUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const bucket = supabase.storage.from(CHAT_BUCKET);
    const result = isImageAttachment(message)
      ? await bucket.createSignedUrl(message.attachmentPath, 300)
      : await bucket.createSignedUrl(message.attachmentPath, 300, {
          download: message.attachmentName ?? true,
        });
    if (result.error) {
      onToast(readableError(result.error));
      return;
    }
    window.open(result.data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <section className={active ? 'chat-panel-root' : 'hidden'}>
      <div className="chat-shell surface-panel">
        <aside className="chat-conversations">
          <div className="chat-sidebar-title">
            <MessageCircle className="size-5" />
            <div>
              <h2>Conversas</h2>
              <p>{groupName}</p>
            </div>
          </div>
          <label className="chat-search">
            <Search className="size-4" />
            <input
              placeholder="Buscar conversas"
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
            />
          </label>
          <div className="chat-conversation-list">
            <p className="chat-list-label">GRUPO</p>
            {visibleConversations
              .filter((item) => item.type === 'group')
              .map((item) => (
                <button
                  key={item.id}
                  data-active={selected?.id === item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="chat-avatar group">
                    <Users className="size-5" />
                  </span>
                  <span className="chat-conversation-copy">
                    <strong>Grupo</strong>
                    <small>Comunicação geral da empresa</small>
                  </span>
                  {item.unread ? <b>{item.unread}</b> : null}
                </button>
              ))}
            <p className="chat-list-label private">CONVERSAS PRIVADAS</p>
            {members
              .filter(
                (member) =>
                  member.userId !== userId &&
                  member.displayName
                    .toLocaleLowerCase('pt-BR')
                    .includes(conversationSearch.toLocaleLowerCase('pt-BR')),
              )
              .map((member) => {
                const item = conversations.find(
                  (conversation) =>
                    conversation.type === 'private' &&
                    conversation.other?.userId === member.userId,
                );
                const online =
                  Date.now() - new Date(member.lastSeenAt).getTime() < 180000;
                return (
                  <button
                    key={member.userId}
                    data-active={selected?.other?.userId === member.userId}
                    onClick={() => void choosePrivate(member)}
                  >
                    <span className="chat-avatar">
                      <Avatar className="size-10">
                        {member.avatarUrl ? (
                          <AvatarImage src={member.avatarUrl} alt="" />
                        ) : null}
                        <AvatarFallback>
                          {initials(member.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <i data-online={online} />
                    </span>
                    <span className="chat-conversation-copy">
                      <strong>{member.displayName}</strong>
                      <small>{online ? 'Online' : 'Offline'}</small>
                    </span>
                    {item?.unread ? <b>{item.unread}</b> : null}
                  </button>
                );
              })}
          </div>
        </aside>

        <div className="chat-room">
          <header className="chat-room-header">
            <div className="chat-room-person">
              <span className="chat-avatar">
                {selected?.type === 'group' ? (
                  <span className="chat-avatar group">
                    <Users className="size-5" />
                  </span>
                ) : (
                  <Avatar className="size-11">
                    {selected?.other?.avatarUrl ? (
                      <AvatarImage src={selected.other.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback>
                      {initials(selected?.other?.displayName ?? 'C')}
                    </AvatarFallback>
                  </Avatar>
                )}
              </span>
              <div>
                <h2>
                  {selected?.type === 'group'
                    ? 'Grupo'
                    : (selected?.other?.displayName ?? 'Conversa')}
                </h2>
                <p>
                  {selected?.type === 'group'
                    ? `${members.length} membros • ${members.filter((member) => Date.now() - new Date(member.lastSeenAt).getTime() < 180000).length} online`
                    : Date.now() -
                          new Date(selected?.other?.lastSeenAt ?? 0).getTime() <
                        180000
                      ? '● Online'
                      : `Última atividade ${selected?.other?.lastSeenAt ? formatTime(selected.other.lastSeenAt) : 'indisponível'}`}
                </p>
              </div>
            </div>
            <label className="chat-inside-search">
              <Search className="size-4" />
              <input
                placeholder="Pesquisar nesta conversa"
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
              />
            </label>
          </header>

          <div
            className="chat-message-viewport"
            ref={listRef}
            onScroll={onScroll}
          >
            {hasOlder && messages[0] ? (
              <button
                className="chat-load-older"
                onClick={() =>
                  void loadMessages(selected!.id, messages[0].createdAt)
                }
              >
                {loading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  'Carregar mensagens anteriores'
                )}
              </button>
            ) : null}
            {!visibleMessages.length && !loading ? (
              <div className="chat-empty">
                <MessageCircle className="size-7" />
                <h3>Comece a conversa</h3>
                <p>
                  As mensagens e arquivos permanecem disponíveis por 30 dias.
                </p>
              </div>
            ) : null}
            {visibleMessages.map((message, index) => {
              const sender = memberMap.get(message.senderId);
              const mine = message.senderId === userId;
              const previous = messages[index - 1];
              const grouped =
                previous?.senderId === message.senderId &&
                new Date(message.createdAt).getTime() -
                  new Date(previous.createdAt).getTime() <
                  5 * 60000;
              const replied = messages.find(
                (item) => item.id === message.replyTo,
              );
              return (
                <article
                  key={message.id}
                  className={mine ? 'chat-message mine' : 'chat-message'}
                  data-grouped={grouped}
                >
                  {!mine && !grouped ? (
                    <Avatar className="chat-message-avatar">
                      {sender?.avatarUrl ? (
                        <AvatarImage src={sender.avatarUrl} alt="" />
                      ) : null}
                      <AvatarFallback>
                        {initials(sender?.displayName ?? 'U')}
                      </AvatarFallback>
                    </Avatar>
                  ) : !mine ? (
                    <span className="chat-message-avatar-spacer" />
                  ) : null}
                  <div className="chat-bubble-wrap">
                    <div className="chat-bubble">
                      {!grouped && !mine ? (
                        <strong>{sender?.displayName ?? 'Membro'}</strong>
                      ) : null}
                      {replied ? (
                        <div className="chat-reply-preview">
                          <b>
                            {memberMap.get(replied.senderId)?.displayName ??
                              'Mensagem'}
                          </b>
                          <span>
                            {replied.content || replied.attachmentName}
                          </span>
                        </div>
                      ) : null}
                      {message.content ? <p>{message.content}</p> : null}
                      {message.attachmentName &&
                      isImageAttachment(message) &&
                      message.attachmentUrl ? (
                        <button
                          className="chat-image-card"
                          onClick={() => void openAttachment(message)}
                          aria-label={'Abrir imagem ' + message.attachmentName}
                        >
                          {/* oxlint-disable-next-line nextjs/no-img-element */}
                          <img
                            src={message.attachmentUrl}
                            alt={message.attachmentName}
                            loading="lazy"
                          />
                          <span>
                            {message.attachmentName} •{' '}
                            {formatSize(message.attachmentSize)}
                          </span>
                        </button>
                      ) : message.attachmentName ? (
                        <button
                          className="chat-file-card"
                          onClick={() => void openAttachment(message)}
                        >
                          <span>
                            <File className="size-5" />
                          </span>
                          <span>
                            <strong>{message.attachmentName}</strong>
                            <small>{formatSize(message.attachmentSize)}</small>
                          </span>
                          <Download className="size-4" />
                        </button>
                      ) : null}
                      <span className="chat-message-meta">
                        {formatTime(message.createdAt)}{' '}
                        {mine ? (
                          message.pending ? (
                            <LoaderCircle className="size-3 animate-spin" />
                          ) : message.failed ? (
                            <X className="size-3 text-red-300" />
                          ) : readMessageIds.has(message.id) ? (
                            <CheckCheck className="size-3" />
                          ) : (
                            <Check className="size-3" />
                          )
                        ) : null}
                      </span>
                      <div className="chat-message-actions">
                        {isPersistedMessageId(message.id) &&
                        !message.pending &&
                        !message.failed ? (
                          <button
                            title="Responder"
                            onClick={() => setReplyTo(message)}
                          >
                            ↩
                          </button>
                        ) : null}
                        <button
                          title="Copiar"
                          onClick={() =>
                            void navigator.clipboard.writeText(message.content)
                          }
                        >
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    {message.failed ? (
                      <button
                        className="chat-retry"
                        onClick={() => void sendMessage(undefined, message)}
                      >
                        Não foi possível enviar • Tentar novamente
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          {newMessages > 0 ? (
            <button className="chat-new-messages" onClick={scrollLatest}>
              <ChevronDown className="size-4" />
              {newMessages} novas mensagens
            </button>
          ) : null}

          <footer className="chat-composer">
            {replyTo ? (
              <div className="chat-replying">
                <span>
                  <b>
                    Respondendo a{' '}
                    {memberMap.get(replyTo.senderId)?.displayName ?? 'mensagem'}
                  </b>
                  <small>{replyTo.content || replyTo.attachmentName}</small>
                </span>
                <button onClick={() => setReplyTo(null)}>
                  <X className="size-4" />
                </button>
              </div>
            ) : null}
            <form onSubmit={sendMessage}>
              <label className="chat-attach-button" aria-label="Anexar arquivo">
                <Paperclip className="size-5" />
                <input
                  type="file"
                  className="sr-only"
                  accept="image/*,.pdf,.docx,.xlsx,.txt,.csv,.zip"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setPendingFile(file);
                    event.target.value = '';
                  }}
                />
              </label>
              <textarea
                rows={1}
                placeholder="Digite uma mensagem..."
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={handleInputKey}
              />
              <Button
                type="submit"
                className="taggi-button-primary chat-send-button"
                aria-label="Enviar"
                disabled={sending || (!text.trim() && !pendingFile)}
              >
                {sending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </form>
            <p className="chat-shortcut">
              Enter envia • Shift + Enter cria uma nova linha
            </p>
          </footer>
        </div>
      </div>

      <Dialog
        open={Boolean(pendingFile)}
        onOpenChange={(open) => {
          if (!open) setPendingFile(null);
        }}
      >
        <DialogContent className="taggi-dialog">
          <DialogHeader>
            <DialogTitle>Enviar arquivo</DialogTitle>
            <DialogDescription>
              Confira o arquivo antes de enviar para esta conversa.
            </DialogDescription>
          </DialogHeader>
          {pendingFile ? <PendingFilePreview file={pendingFile} /> : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="taggi-button-subtle"
              onClick={() => setPendingFile(null)}
            >
              Cancelar
            </Button>
            <Button
              className="taggi-button-primary"
              onClick={() => void sendMessage()}
            >
              Enviar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={noticeOpen && !noticeSeen} onOpenChange={() => undefined}>
        <DialogContent
          className="taggi-dialog sm:max-w-md"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>Sobre o histórico do chat</DialogTitle>
            <DialogDescription>
              Para manter o Tage rápido e otimizar o armazenamento, as mensagens
              e arquivos enviados pelo chat ficam disponíveis durante 30 dias.
              Após esse período, são removidos automaticamente.
            </DialogDescription>
          </DialogHeader>
          <Button
            className="taggi-button-primary w-full"
            onClick={() => void acknowledgeNotice()}
          >
            Entendi
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

# Releases e atualizações do Tage

O fluxo obrigatório é:

```text
LOCAL → TESTES → BUILD DE TESTE → BETA → APROVAÇÃO EXPLÍCITA → STABLE
```

Uma build nunca publica sozinha. Comentários como “gostei”, “ficou bom” ou
“aprovado visualmente” não executam nenhum comando.

## Comandos do dia a dia

| Objetivo | Comando | Publica? |
| --- | --- | --- |
| Abrir o desktop em desenvolvimento | `pnpm dev` | Não |
| Abrir somente o projeto web | `pnpm web:dev` | Não |
| Gerar instalador de homologação | `pnpm build:test` | Não |
| Validar código/build sem publicar | `pnpm release:dry` | Não |
| Publicar a próxima Beta | `pnpm release:beta` | Sim, após confirmação |
| Publicar correção Stable | `pnpm release:patch` | Sim, após confirmação |
| Publicar funcionalidade Stable | `pnpm release:minor` | Sim, após confirmação |
| Publicar grande versão Stable | `pnpm release:major` | Sim, após confirmação |
| Promover a Beta testada | `pnpm promote:stable` | Sim, após confirmação |
| Consultar configuração local | `pnpm release:status` | Não |
| Interromper uma versão | `pnpm release:block -- 1.5.1` | Altera a release após confirmação |

O projeto também aceita `npm run <nome>`, mas o lockfile oficial é do pnpm.

## Como testar uma alteração

1. Execute `pnpm dev`.
2. O Vite abre o renderer e o Electron abre o Tage local.
3. Faça o teste. O updater fica desativado no canal Local.
4. Para reproduzir o empacotamento real, execute `pnpm build:test`.

A build de teste usa configuração de produção, gera NSIS e blockmap em
`release/test`, mostra “NÃO PUBLICADA” e força `--publish never`. Ela não
altera a versão Stable nem o catálogo no Supabase.

## Antes da primeira Beta

São ações externas obrigatórias:

1. Aplicar a migration
   `supabase/migrations/20260830002948_taggi_release_management.sql`.
2. Criar um repositório GitHub **público** somente para artefatos de update.
   O código-fonte pode permanecer em outro repositório privado. O repositório
   de updates precisa ser público para o cliente baixar sem receber um token
   privado dentro do executável.
3. Copiar `.env.release.example` para um ambiente seguro ou configurar os
   mesmos nomes nos secrets do pipeline.
4. Adquirir/configurar um certificado Authenticode de assinatura de código.
5. Preencher `RELEASE_NOTES.md` com notas reais e curtas.
6. Manter o worktree limpo e com o código revisado em commit.

Se a migration/política não puder ser consultada, o cliente falha de modo
seguro no canal Stable; ele nunca assume Beta por conta própria.

Nunca coloque `GH_TOKEN`, `service_role`, certificado ou senha em
`.env.local`, variáveis `VITE_*` ou no código cliente.

## Assinatura digital no Windows

O Electron Builder usa:

- `WIN_CSC_LINK`: caminho seguro ou certificado em Base64;
- `WIN_CSC_KEY_PASSWORD`: senha do certificado;
- alternativamente `TAGGI_CERTIFICATE_SUBJECT_NAME` para um certificado do
  Windows Certificate Store.

Stable falha antes de publicar se não houver assinatura. O preflight gera um
instalador completo, verifica o checksum SHA-512, o blockmap e exige status
Authenticode `Valid`. Beta também exige certificado por padrão. Somente uma
homologação controlada pode optar por
`TAGGI_ALLOW_UNSIGNED_BETA=1`.

Arquivos `.pfx`, `.p12`, `.pem` e ambientes locais estão ignorados pelo
Git.

## Autorizar este computador para Beta

1. Instale/abra o Tage e faça login uma vez.
2. O aplicativo registra somente: hash aleatório da instalação, usuário,
   versão, build, canal e última atividade.
3. No Supabase Dashboard, consulte:

```sql
select id, user_id, installation_id_hash, channel, app_version, last_seen_at
from public.taggi_release_devices
order by last_seen_at desc;
```

4. Confirme o registro correto e autorize pelo `id`:

```sql
update public.taggi_release_devices
set channel = 'beta'
where id = 123;
```

O cliente autenticado pode ler apenas o próprio registro e não possui
privilégio para mudar `channel` ou `enabled`. Não há segredo administrativo
no executável. Para retirar a autorização:

```sql
update public.taggi_release_devices
set channel = 'stable'
where id = 123;
```

## Publicar Beta

1. Preencha `RELEASE_NOTES.md`.
2. Execute `pnpm release:beta`.
3. A rotina valida lint crítico, testes, TypeScript/renderer, instalador,
   updater, checksum e assinatura.
4. Confirme digitando o token exato mostrado, por exemplo
   `PUBLICAR-BETA-1.5.0-beta.1`.
5. Somente dispositivos autorizados para Beta passam a consultar o canal
   `beta`. Stable continua consultando `latest`.

Uma nova Beta do mesmo commit incrementa `beta.1`, `beta.2`, etc. O estado
local fica em `.taggi/release-state.json` e não entra no Git.

## Promover Beta para Stable

Execute `pnpm promote:stable`. A promoção só continua se o commit atual for
exatamente o commit da última Beta registrada. Antes da confirmação, a rotina
mostra Beta, nova Stable, build, testes, assinatura e updater.

A confirmação é específica, por exemplo
`PUBLICAR-STABLE-1.5.0`. O comando reconstrói e publica a versão sem sufixo.
Não existe promoção automática por texto em linguagem natural.

`release:patch`, `release:minor` e `release:major` reutilizam exatamente a
mesma validação e publicação.

## Download, instalação e preservação de dados

- O download acontece em segundo plano.
- A versão atual continua instalada durante o download.
- Download incompleto/corrompido é recusado pelo SHA-512 do updater.
- Stable assinado também valida a assinatura Authenticode.
- Depois do download, o Tage cria e verifica um backup antes de oferecer
  “Reiniciar e atualizar”.
- “Mais tarde” não instala nada.
- O usuário precisa clicar “Reiniciar e atualizar”.

O backup contém somente preferências `taggi:*` e a sessão local Supabase
`sb-*-auth-token`. Ele fica em
`%APPDATA%/Taggi/taggi-backups` e mantém no máximo os dois backups mais
recentes. O backup novo é escrito, relido e validado antes de remover o mais
antigo.

Pedidos, contagens, empresas, mensagens e histórico continuam no Supabase e
não fazem parte do instalador ou do backup local.

Na primeira execução após update, o Tage valida versão, renderer,
configurações e disponibilidade do backend, registrando o resultado em
`%APPDATA%/Taggi/taggi-system/update-transition.json`. Logs técnicos rotativos
ficam em `%APPDATA%/Taggi/logs/taggi-updater.log`.

## Versão mínima, bloqueio e rollback

`TAGGI_MINIMUM_SUPPORTED_VERSION` define a menor versão aceita na próxima
publicação. Use somente quando necessário e mantenha o backend compatível com
versões antigas durante atualização gradual.

Para interromper novos downloads:

```text
pnpm release:block -- 1.5.1
```

Para também apontar o catálogo a uma versão segura:

```text
pnpm release:block -- 1.5.1 1.5.0
```

O comando transforma a release problemática em draft no GitHub, marca
`BLOCKED` no Supabase e atualiza `blocked_versions`.

Rollback automático para uma versão menor está deliberadamente desativado.
Isso evita abrir um cliente antigo incompatível com migrations novas. O
procedimento seguro é bloquear a versão e publicar rapidamente um patch de
versão **maior**. Instalação manual de uma versão anterior só deve ser usada
após auditoria de compatibilidade de schema, RLS, funções e dados locais.

O campo `rollout_percentage` já existe para rollout futuro, mas distribuição
gradual ainda não está ativada no provedor.

## Teste end-to-end antes de considerar o updater concluído

- [ ] Aplicar migrations num projeto de homologação.
- [ ] Publicar uma Stable assinada de base e instalá-la em VM de teste.
- [ ] Fazer login, escolher empresa e alterar aparência.
- [ ] Publicar Beta e confirmar que Stable não a recebe.
- [ ] Autorizar a VM Beta e confirmar download/interrupção/repetição.
- [ ] Instalar, reabrir e confirmar sessão, empresa, preferências e dados.
- [ ] Promover o mesmo commit e atualizar uma segunda VM Stable.
- [ ] Corromper um artefato somente em hospedagem de teste e confirmar recusa.
- [ ] Bloquear uma release de teste e confirmar que novos downloads param.
- [ ] Validar uma falha controlada de inicialização, sem clientes reais.

Sem repositório de updates, secrets, certificado e ambiente de homologação,
esses testes permanecem pendentes e não devem ser marcados como concluídos.
O teste local de SQL também exige Docker em execução (`supabase start`).

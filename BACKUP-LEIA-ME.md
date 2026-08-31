# Taggi 1.0.0 — backup completo do projeto

Este pacote contém o código-fonte e os arquivos necessários para continuar o desenvolvimento do Taggi ou reconstruir o aplicativo para Windows.

## Conteúdo preservado

- Código da interface e do aplicativo desktop.
- Configurações do projeto e do empacotamento Electron.
- Componentes, estilos, ícones e demais recursos visuais.
- Integração com Supabase, migrações, políticas de segurança e testes.
- Configuração de Sites.
- Estado completo e mais recente do código, incluindo alterações ainda não publicadas.
- Arquivos de dependências com versões travadas.
- Estrutura do Supabase preservada como código: migrações, funções e políticas.
- Instalador de teste entregue separadamente do pacote estrutural.

## Arquivos recriáveis não incluídos

Para manter o backup adequado para upload e evitar arquivos redundantes, não foram incluídos `node_modules`, caches locais, resultados temporários de compilação, a pasta descompactada do Electron e instaladores antigos. Nenhum código-fonte necessário foi removido.

O arquivo `.env.local` também não foi incluído. O projeto Supabase anterior foi excluído e esta entrega fica propositalmente sem backend ativo enquanto as funções e o design são refinados. Quando chegar a etapa final, copie `.env.example` para `.env.local` e preencha apenas a URL e a chave publicável do novo projeto.

## Como restaurar

Requisitos: Windows, Node.js 22.13 ou superior e pnpm.

1. Extraia o arquivo ZIP.
2. Abra a pasta extraída em um ambiente de desenvolvimento.
3. Execute `pnpm install` para restaurar as dependências.
4. Execute `pnpm dev` para trabalhar na versão web local.
5. Execute `pnpm desktop:package` para gerar um novo instalador do aplicativo desktop.

O processo atual de builds, Beta, Stable, assinatura e updater está descrito
em `RELEASE.md`. `pnpm desktop:package` é um alias seguro de
`pnpm build:test` e nunca publica.

## Segurança

Nenhuma credencial do Supabase está presente neste pacote. Nunca adicione ao código cliente uma chave `service_role`, senha de banco de dados ou outro segredo administrativo.

Backup estrutural preparado em 30 de agosto de 2026.

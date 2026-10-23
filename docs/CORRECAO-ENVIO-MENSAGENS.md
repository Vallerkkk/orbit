# Correção: "permission denied" ao enviar mensagens

## Como aplicar
No Supabase → SQL Editor, cole e execute o conteúdo de
`supabase/migrations/20261022223000_fix_message_insert_permissions.sql`
(ou rode `supabase db push`). É idempotente.

## Se ainda falhar: diagnóstico exato
Troque `SEU_USER_ID` e `ID_DO_CANAL` e execute. Nada é gravado (rollback).

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub','SEU_USER_ID','role','authenticated')::text, true);
set local role authenticated;
insert into public.messages(channel_id, author_id, content) values ('ID_DO_CANAL','SEU_USER_ID','teste diagnóstico');
rollback;
```
A mensagem de erro mostra a tabela/função/coluna sem permissão. Envie-a para análise.


## Causa confirmada (22/10/2026)

No banco de produção o erro era `42501 permission denied for function valid_poll`: a constraint `CHECK (orbita_private.valid_poll(poll))` em `messages`/`direct_messages` é avaliada com as permissões de quem insere, e `authenticated` não tinha `EXECUTE` em `orbita_private.valid_poll(jsonb)`. A migration agora inclui:

```sql
grant execute on function orbita_private.valid_poll(jsonb) to authenticated;
```

# Governança do Avanço

## Papéis

- `owner`: controle total da organização e administradores.
- `admin`: usuários, configurações, exclusões e operação completa.
- `manager`: operação completa, leitura de auditoria e aprovações.
- `analyst`: clientes, reservas, repasses, documentos e mensagens.
- `broker`: clientes e reservas; sem exclusões ou governança financeira.
- `viewer`: somente leitura dos dados da própria organização.

## Controles técnicos

- Isolamento multiempresa por `organization_id` em todas as entidades.
- RLS obrigatório em todas as tabelas expostas pela API.
- Políticas separadas de leitura, criação, alteração e exclusão.
- Documentos privados no Storage, organizados por `<organization_id>/<reservation_id>/...`.
- Trilha imutável de alterações em `audit_events`.
- Logs de autenticação nativos do Supabase em `auth.audit_log_entries`.
- Chave `service_role` somente no backend; nunca no frontend.
- Migrações SQL versionadas em `supabase/migrations`.

## Matriz de aprovação

| Ação | Papéis permitidos |
|---|---|
| Consultar carteira | Todos os membros ativos |
| Criar/alterar reserva | Owner, Admin, Manager, Analyst, Broker |
| Operar repasse | Owner, Admin, Manager, Analyst |
| Aprovar documento | Owner, Admin, Manager, Analyst |
| Excluir cliente/reserva/repasse | Owner, Admin |
| Consultar auditoria | Owner, Admin, Manager |
| Gerenciar usuários e papéis | Owner, Admin |

## Operação

1. Mudanças de banco entram por migração revisada.
2. Produção recebe backup antes de migrações destrutivas.
3. Acesso é revisto trimestralmente e removido no desligamento.
4. Incidentes e alterações sensíveis são rastreados pela auditoria.
5. Segredos ficam apenas nos ambientes da Vercel e Supabase.

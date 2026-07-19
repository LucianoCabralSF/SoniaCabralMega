# Sincronização Agenda–Caixa e Lembretes Automáticos — Design

**Data:** 19/07/2026
**Status:** aprovado pela autorização prévia de Luciano para decidir e registrar escolhas sem interromper a execução

## Objetivo

Eliminar registros órfãos entre agenda, caixa e relacionamento; impedir que retornos de atendimentos excluídos continuem nas filas; corrigir telefones brasileiros importados; e preparar o envio automático e auditável de lembretes de agendamento pelo WhatsApp Business oficial.

## Causas confirmadas

1. A conclusão cria o caixa com `itemId = agcash:<agendamentoId>`, mas `saveLancamento`, `saveAgendamento`, `deleteLancamento` e `deleteAgendamento` operam de forma independente.
2. A oportunidade do próximo retorno é criada com `referenciaId = retorno:<agendamentoId>` e não é encerrada nem excluída quando agenda ou caixa são excluídos.
3. A edição do caixa permite substituir `itemId` e `itemTipo`, o que pode destruir o vínculo técnico com a agenda.
4. A importação salva o telefone recebido do celular sem forma canônica. O normalizador aceita `55` uma vez, mas não corrige prefixo brasileiro duplicado.
5. O fluxo atual abre `wa.me` e depende de confirmação humana; não existe fila, acionador, provedor automático ou histórico de tentativas.

## Abordagens consideradas

### 1. API oficial do WhatsApp Business com fila e acionador — escolhida

Usa modelo previamente aprovado na Meta, `UrlFetchApp` no backend e acionador instalável do Apps Script. Oferece idempotência, auditoria, falha explícita e menor risco operacional.

### 2. Continuar com `wa.me`

É simples e permanece útil como contingência manual, mas não atende ao requisito de envio sem intervenção.

### 3. Conector não oficial ligado ao WhatsApp pessoal

Permite texto livre, porém depende de sessão instável e aumenta o risco de bloqueio do número. Foi descartado.

## Arquitetura

### Vínculo transacional

O backend passa a ser a única autoridade para operações em registros vinculados. Os identificadores existentes serão preservados:

- caixa originado da agenda: `itemId = agcash:<agendamentoId>` e `itemTipo = agendamento`;
- retorno criado pela conclusão: `referenciaId = retorno:<agendamentoId>`;
- lembrete: chave derivada de agendamento, data e hora.

Uma função resolve o conjunto vinculado e outra aplica edição ou exclusão sob um único `DocumentLock`. A exclusão iniciada na agenda ou no caixa terá o mesmo resultado:

1. arquivar o agendamento;
2. arquivar o caixa vinculado;
3. arquivar a oportunidade futura criada por aquele atendimento;
4. cancelar lembretes ainda não enviados;
5. desfazer o vínculo da oportunidade anterior usada para gerar o agendamento, preservando o histórico de eventos.

A operação será idempotente: repetir uma exclusão já concluída retornará sucesso sem criar novos efeitos.

### Regras de edição

Campos compartilhados — cliente, nome da cliente, serviço/descrição e valor — serão sincronizados. Data do caixa e data/hora da agenda permanecerão independentes, pois a conclusão já permite que a data financeira seja diferente da data do atendimento. Forma de pagamento, categoria financeira, colaboradora, duração e observações específicas também permanecem em suas entidades.

Ao editar um caixa originado da agenda, o backend preservará `agcash:<id>` e `itemTipo = agendamento`, mesmo que o navegador envie outro item. Ao editar um atendimento concluído, o caixa vinculado receberá os campos compartilhados. Ao editar um agendamento futuro, a fila de lembrete será reconciliada com a nova data e hora.

### Retornos

Uma oportunidade `retorno:<agendamentoId>` só pode permanecer ativa enquanto o atendimento que a originou existir. A listagem também terá defesa adicional: retornos cuja referência aponta para agendamento excluído serão tratados como encerrados, mesmo antes de uma limpeza física dos dados antigos.

## Telefones brasileiros

Haverá uma única regra pura compartilhada pelo relacionamento e pelos lembretes:

1. remover caracteres não numéricos e prefixo internacional `00`;
2. remover um `55` duplicado quando o restante formar um número brasileiro válido;
3. adicionar `55` apenas a números nacionais com 10 ou 11 dígitos;
4. aceitar somente `55` + DDD de dois dígitos + número local de 8 ou 9 dígitos;
5. retornar vazio para entradas ambíguas ou inválidas.

A importação aplicará essa regra antes de comparar duplicatas e antes de salvar. O backend repetirá a normalização para impedir que clientes antigas ou outro navegador contornem a regra. A interface exibirá o número em formato brasileiro, mas o envio usará somente dígitos canônicos.

## Lembretes automáticos

### Agendamento e horário

- antecedência configurável: 3 ou 4 horas; padrão 4;
- cálculo no fuso `America/Manaus`;
- envio somente na data do agendamento;
- nunca antes de `horaInicio` do salão;
- se `início - antecedência` cair antes da abertura, programar na abertura;
- nunca enviar no horário ou depois do início do atendimento;
- agendamentos cancelados, concluídos, excluídos, clientes com `naoContatar` ou telefone inválido não são elegíveis.

Um acionador instalável executará `processarLembretesAutomaticos_` a cada 15 minutos. A função usará lock e chave idempotente para impedir duplicidade entre execuções concorrentes.

### Persistência e estados

Nova aba `lembretes_envios`:

`id`, `idempotencyKey`, `agendamentoId`, `clienteId`, `tipo`, `agendamentoData`, `agendamentoHora`, `programadoPara`, `telefone`, `mensagem`, `status`, `tentativas`, `providerMessageId`, `ultimoErro`, `enviadoEm`, `criadoEm`, `atualizadoEm`, `deletadoEm`.

Estados operacionais: `pendente`, `enviando`, `enviado`, `erro`, `cancelado` e `expirado`. Uma tentativa só vira `enviado` quando a API retornar identificador de mensagem. Erros podem ser repetidos até três vezes, somente antes do atendimento.

### Integração com a Meta

O backend enviará um modelo aprovado por `POST /<phone-number-id>/messages` na Graph API. O token de acesso ficará em `ScriptProperties`, nunca na planilha, no frontend, em logs ou na resposta de configuração. O nome do modelo, idioma, versão da API e ID do número serão configuráveis; a API retornará apenas `tokenConfigurado: true|false`.

O envio automático começará desativado. Só poderá ser ativado quando telefone da empresa, token e nome do modelo estiverem configurados. O fluxo manual por `wa.me` será mantido como contingência.

### Modelo e prévia

Mensagem padrão:

> Olá, {nome}! Lembramos que seu atendimento de {servico} na {salao} está marcado para hoje, {data}, às {hora}. Responda a esta mensagem para confirmar seu horário. Até breve!

Variáveis permitidas: `{nome}`, `{servico}`, `{salao}`, `{data}` e `{hora}`. A prévia local será salva e registrada no histórico. Como mensagens iniciadas pela empresa exigem modelo aprovado, a tela avisará que alterações de texto também precisam ser refletidas no modelo aprovado na Meta.

## Interface

Em Configurações haverá a seção “Mensagens automáticas” com:

- chave ativar/desativar;
- antecedência 3 ou 4 horas;
- textarea do modelo padrão e prévia com dados fictícios;
- nome e idioma do modelo aprovado;
- versão da API, ID do número e campo de token com estado mascarado;
- botão para salvar/testar configuração;
- estado do acionador e da integração;
- últimos envios com horário, cliente, status e erro resumido;
- lista de clientes com telefone inválido e atalho para edição.

Todos os textos vindos do backend serão escapados. A seção seguirá os componentes e a responsividade já usados em Configurações.

## Rotas

Leituras autenticadas:

- `getLembretesConfig` — configuração sem segredo e situação do acionador;
- `getLembretesEnvios` — histórico recente;
- `getClientesTelefonePendente` — clientes que exigem revisão.

Escritas autenticadas:

- `saveLembretesConfig` — valida opções e salva segredo apenas quando informado;
- `testWhatsAppConfig` — valida configuração sem enviar a clientes reais;
- `runLembretesNow` — reconcilia e processa a fila para diagnóstico controlado.

As rotas de edição e exclusão existentes passarão a delegar ao serviço transacional de vínculo.

## Tratamento de falhas

- Falha ao atualizar qualquer registro central reverte os registros já alterados usando snapshots da linha.
- Falha no WhatsApp nunca altera agenda ou caixa e nunca marca envio como concluído.
- Configuração incompleta mantém automação desativada com mensagem objetiva.
- Resposta HTTP sem ID de mensagem é erro, mesmo com código 2xx.
- Token e payload de autorização nunca aparecem em `ultimoErro`.
- Registros antigos inconsistentes são reconciliados gradualmente quando listados, editados ou processados.

## Testes e critérios de aceite

1. Excluir caixa `agcash:<id>` remove caixa, agenda, retorno futuro e lembrete pendente.
2. Excluir agenda produz exatamente o mesmo resultado e repetir a exclusão é seguro.
3. Editar campos compartilhados em qualquer lado atualiza o outro sem mudar datas independentes.
4. Editar um agendamento futuro cancela a chave antiga e agenda a nova.
5. Retorno órfão nunca aparece em “próximos”.
6. `+55`, número nacional e `55` existente normalizam para o mesmo valor; `55` duplicado é corrigido.
7. Duplicatas na importação são detectadas pela forma canônica.
8. Lembrete das 09:00 com salão abrindo 08:00 é programado para 08:00; o das 14:00 com antecedência de 4 horas é programado para 10:00.
9. Nada é enviado antes da abertura, depois do início, para canceladas, bloqueadas ou números inválidos.
10. Execuções repetidas não duplicam mensagens.
11. Segredo nunca é devolvido ao frontend.
12. Interface funciona em desktop e 390 px sem rolagem horizontal da página.

## Fora do escopo

- criação ou aprovação automática de modelos na Meta;
- interpretação automática da resposta “confirmo” por webhook;
- campanhas automáticas em massa;
- uso de conectores não oficiais.

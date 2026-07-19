# Sonia Cabral — Central de Relacionamento

## Objetivo

Criar uma central simples de relacionamento que aumente o retorno das clientes sem transformar o sistema em um CRM complexo. A equipe deverá identificar quem precisa ser contatada, abrir uma mensagem personalizada no WhatsApp, acompanhar o avanço do contato e medir quantas clientes realmente retornaram.

## Escopo aprovado

A primeira versão contempla:

- indicação manual da data recomendada para retorno ao concluir um atendimento;
- filas de retornos próximos, retornos atrasados há pelo menos 15 dias, aniversariantes e campanhas;
- WhatsApp assistido, sempre com confirmação humana do envio;
- funil `contatada → respondeu → agendou → retornou`;
- atualização automática de `agendou` e `retornou` quando for possível relacionar um agendamento;
- histórico por cliente e indicadores de conversão;
- bloqueio de mensagens para clientes marcadas como “não contatar”.

Não fazem parte desta versão: envio automático de WhatsApp, integração com API paga do WhatsApp, chatbot, disparos em massa sem confirmação humana, pontuação de leads ou funis adicionais.

## Arquitetura e limites

A Central será um módulo próprio na aplicação atual. Ela consumirá clientes e agendamentos existentes, mas manterá oportunidades, campanhas e eventos de contato em estruturas separadas. A agenda continuará funcionando mesmo que o módulo de relacionamento falhe, e um erro no CRM não poderá desfazer um atendimento ou lançamento financeiro já concluído.

O frontend seguirá o padrão da aplicação de página única. O backend continuará no Google Apps Script, com ações autenticadas específicas para consulta e alteração do relacionamento. Os dados continuarão no Google Sheets.

## Modelo de dados

### Extensões de estruturas existentes

`clientes` receberá `naoContatar`, com valor booleano normalizado. Clientes existentes serão consideradas contatáveis até que o bloqueio seja marcado.

`agendamentos` receberá:

- `retornoRecomendado`: data ISO `YYYY-MM-DD`, definida no fluxo de conclusão quando houver retorno;
- `retornoMotivo`: texto curto, preenchido inicialmente com o serviço do atendimento e editável;
- `oportunidadeId`: vínculo opcional com a oportunidade que originou o novo agendamento.

Na conclusão, a equipe deverá informar a data ou escolher explicitamente “sem retorno recomendado”.

### Nova estrutura `relacionamento`

Cada linha representa uma oportunidade de relacionamento e contém:

- identificador;
- cliente;
- origem: `retorno`, `aniversario` ou `campanha`;
- referência ao atendimento ou campanha de origem;
- data-alvo;
- etapa atual;
- telefone e mensagem usados no último contato;
- datas de contato, resposta, agendamento e retorno;
- agendamento vinculado;
- motivo de encerramento sem conversão, quando aplicável;
- observações, criação, atualização e exclusão lógica.

`pendente` será um estado de fila, anterior ao funil. O funil medido começa somente em `contatada`.

### Nova estrutura `relacionamento_eventos`

Cada mudança será registrada em uma linha imutável com oportunidade, cliente, tipo do evento, etapa anterior, nova etapa, origem manual ou automática, data e hora, telefone, mensagem e observação. A estrutura `relacionamento` manterá o estado atual para consultas rápidas; `relacionamento_eventos` será a fonte do histórico e da auditoria.

### Nova estrutura `campanhas`

Cada campanha conterá nome, modelo de mensagem, período, critérios de público, status e metadados de auditoria. Ao ativá-la, o sistema criará no máximo uma oportunidade por cliente para aquela campanha.

## Geração das oportunidades

### Retorno recomendado

Ao concluir o atendimento, a interface solicitará a data recomendada e o motivo. A conclusão do atendimento e do caixa continuará sendo atômica como hoje. Depois de confirmada essa conclusão, o backend criará a oportunidade de retorno. Se a criação da oportunidade falhar, o atendimento permanecerá concluído e a interface informará que o relacionamento precisa ser recriado, sem duplicar o caixa.

A oportunidade aparecerá em “Retornos próximos” nos sete dias anteriores à data-alvo. Se não houver retorno, aparecerá em “Recuperar clientes” a partir de 15 dias após a data recomendada.

### Aniversário

A fila considerará dia e mês do aniversário cadastrado e criará uma oportunidade por cliente e ano. Cliente sem telefone ou marcada como “não contatar” não ficará na fila de envio.

### Campanha

A equipe definirá o nome, a mensagem e o público por filtros verificáveis nos dados atuais: período do último atendimento concluído, serviço realizado, mês de aniversário, retorno atrasado ou seleção manual. A criação será idempotente: reabrir ou recalcular uma campanha não duplicará oportunidades já existentes.

## Fluxo do funil

1. A equipe seleciona uma oportunidade e revisa a mensagem sugerida.
2. O sistema abre `wa.me` com telefone normalizado e mensagem codificada.
3. Abrir o WhatsApp não altera a etapa. A interface solicita confirmação de envio.
4. Confirmado o envio, a oportunidade passa para `contatada` e guarda data, telefone e mensagem.
5. `respondeu` é marcada manualmente.
6. Ao salvar um novo agendamento para a mesma cliente, o backend procurará uma oportunidade já `contatada` ou `respondeu`, criada antes do agendamento, e fará o vínculo automático. Quando o agendamento for iniciado pela Central, o identificador da oportunidade será enviado explicitamente e terá prioridade. Depois do vínculo, a etapa passará para `agendou`.
7. Ao concluir o agendamento vinculado, a oportunidade passará automaticamente para `retornou`.

Alterações automáticas serão monotônicas: o sistema nunca fará uma oportunidade retroceder. Ajustes manuais serão permitidos e registrados com data de atualização.

Quando houver mais de uma oportunidade aberta para a mesma cliente, o vínculo automático obedecerá a esta prioridade: oportunidade escolhida na Central; retorno com data-alvo mais próxima; campanha mais recente. A recuperação será uma fila calculada para retornos atrasados, não uma segunda oportunidade. Somente uma oportunidade receberá o vínculo automático, evitando contar um único retorno mais de uma vez.

Se a cliente já possuir agendamento futuro criado antes de qualquer contato, a oportunidade sairá da fila de envio e será encerrada como retorno espontâneo. Ela não será creditada como conversão do funil e não acrescentará uma nova etapa visível.

## Experiência da Central

A tela terá:

- resumo com oportunidades pendentes, contatos, respostas, agendamentos e retornos;
- filtros por fila, etapa, origem, campanha, atraso e período;
- lista de oportunidades com nome, telefone, último atendimento, serviço, data-alvo, atraso e ação principal;
- ação de WhatsApp com mensagem editável;
- controles diretos das quatro etapas;
- histórico cronológico da cliente.

No celular, a lista será apresentada em cartões. No desktop, será apresentada em tabela compacta. Os filtros mais frequentes permanecerão visíveis e os demais ficarão em um painel secundário.

## Indicadores

Para o período selecionado, a Central calculará:

- oportunidades elegíveis;
- taxa de contato: contatadas ÷ elegíveis;
- taxa de resposta: responderam ÷ contatadas;
- taxa de agendamento: agendaram ÷ responderam;
- taxa de retorno: retornaram ÷ agendaram;
- clientes recuperadas: retornos concluídos cuja oportunidade estava atrasada pelo menos 15 dias quando foi contatada;
- tempo médio entre contato, agendamento e retorno.

Divisões com denominador zero exibirão zero, nunca `NaN` ou infinito. Cada cliente será contada uma vez por oportunidade no período.

## Validação e tratamento de falhas

- Datas precisam ser reais e não podem ser anteriores ao atendimento concluído.
- Telefone será normalizado para dígitos; números insuficientes impedirão a abertura do WhatsApp e sinalizarão cadastro incompleto.
- Cliente marcada como “não contatar” ficará excluída de novas filas e terá a ação de WhatsApp bloqueada, sem apagar o histórico anterior.
- A criação e atualização de oportunidades usarão chave idempotente baseada em origem e referência. Se a conclusão do atendimento for confirmada, mas a criação da oportunidade falhar, uma nova tentativa usará a mesma chave e não duplicará o caixa nem o relacionamento.
- Referências a cliente, campanha e agendamento serão validadas no backend.
- Textos vindos da planilha ou digitados pela equipe serão escapados antes de entrar no HTML.
- Falha de rede preservará o estado anterior e oferecerá nova tentativa; nenhuma etapa será antecipada apenas na interface.

## Testes

A cobertura deverá incluir:

- criação única da oportunidade depois da conclusão;
- janelas de sete dias antes e 15 dias depois da data-alvo;
- aniversário em viradas de mês e ano;
- bloqueio por telefone inválido e por “não contatar”;
- confirmação obrigatória antes de marcar `contatada`;
- progressão e não regressão automática do funil;
- vínculo correto quando a cliente possui várias oportunidades;
- transição automática para `agendou` e `retornou`;
- ausência de duplicidade ao repetir requisições;
- cálculo dos indicadores com listas vazias;
- comportamento responsivo e navegação por teclado nos fluxos principais.

## Critérios de aceitação

- A equipe consegue concluir um atendimento indicando o próximo retorno.
- A Central separa corretamente retornos próximos, recuperações, aniversários e campanhas.
- O WhatsApp abre com mensagem e telefone corretos, mas só registra contato depois da confirmação.
- As quatro etapas possuem histórico e não contam um retorno duas vezes.
- Agendamentos criados pela Central e posteriormente concluídos atualizam o funil automaticamente.
- Clientes sem telefone ou bloqueadas não podem receber mensagens.
- Indicadores conferem com as oportunidades visíveis para o mesmo período.
- Falhas do módulo não alteram registros já consolidados de agenda ou caixa.

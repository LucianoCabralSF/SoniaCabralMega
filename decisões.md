# Decisões para revisão do Luciano

Data: 19/07/2026

## Contexto e autorização

Luciano autorizou a correção integral dos problemas encontrados, pediu que decisões importantes fossem tomadas de forma autônoma e registradas neste arquivo, e solicitou que o trabalho continuasse sem perguntas enquanto ele descansa.

## Abordagens consideradas

1. **Correção incremental compatível (escolhida):** preservar Vercel, Google Apps Script e Google Sheets; extrair somente regras críticas para módulos testáveis; migrar autenticação e dados sem exigir recriação da planilha.
2. **Refatoração completa do frontend:** separar o `index.html` em componentes e módulos. Melhoraria manutenção, mas ampliaria muito a superfície de regressão nesta entrega.
3. **Reescrita com banco e provedor de identidade:** seria a solução estrutural mais forte, porém exigiria nova infraestrutura, migração de dados e decisões de custo/operação que não são necessárias para corrigir o sistema atual.

## Decisões adotadas

### Segurança e autenticação

- O login passará a usar `POST`; senha não será mais enviada na URL.
- A senha deixará de ser devolvida por `getConfig` e de ser gravada no navegador.
- A senha existente em texto puro será migrada automaticamente para hash com salt no primeiro login bem-sucedido após o deploy. O valor legado será removido da configuração.
- Instalações novas não receberão a senha previsível `1234`. A senha inicial deverá ser definida pela função administrativa documentada no Apps Script.
- Troca de senha exigirá a senha atual, terá mínimo de 8 caracteres e revogará todas as sessões.
- “Manter conectada” será respeitado: marcada usa token persistente; desmarcada usa somente a sessão da aba.
- Logout limpará tokens e caches sensíveis do navegador e tentará revogar o token no backend.
- O backend limitará tentativas consecutivas de login para reduzir força bruta.
- O contador de tentativas será serializado. Depois do limite, as verificações também serão processadas uma por vez com atraso; a senha correta continuará aceita após essa espera para impedir que um atacante trave o salão inteiro.
- Configurações alteráveis serão limitadas a uma lista permitida; senha terá rota própria.

### Integridade financeira

- Valores monetários críticos serão calculados em centavos inteiros.
- Diferenças de divisão serão distribuídas entre parcelas, garantindo que a soma seja exatamente igual ao total.
- Pagamento maior que o saldo será rejeitado.
- Uma parcela só será marcada como paga quando o valor recebido for exatamente o valor aberto dela. Pagamento parcial continuará possível pela opção “sem parcela”.
- Pagamentos receberão chave de idempotência para impedir duplicidade por repetição de requisição.
- Atualizações compostas terão rollback de melhor esforço quando uma etapa posterior falhar.

### Planejamento

- Edição será implementada de verdade.
- Campos estruturais poderão ser alterados somente enquanto não houver parcela paga; nesse caso as parcelas abertas serão regeneradas.
- Exclusão será oferecida no frontend e permitida somente quando não houver parcela paga, preservando histórico financeiro.
- Vencimentos nos dias 29, 30 e 31 serão limitados ao último dia do mês.

### Cache e funcionamento offline

- Falha de rede não poderá salvar listas vazias como cache válido.
- Dados em cache terão indicação de atualização/estado offline.
- Logout removerá clientes, crediário, agenda e dados financeiros armazenados localmente.
- O service worker não armazenará respostas com erro e só devolverá o HTML principal como fallback de navegação.

### UX e acessibilidade

- Zoom do navegador será permitido.
- Controles receberão nomes acessíveis, estados e foco visível.
- Botões somente com ícones terão `aria-label` e área mínima de toque.
- Alertas e diálogos serão anunciados por tecnologias assistivas.
- “Resultado Operacional” do início será renomeado para “Resultado projetado”, pois inclui obrigações ainda não pagas.
- Confirmações destrutivas identificarão o registro afetado.

### Testes e entrega

- Será criada uma suíte sem dependências externas usando o test runner nativo do Node.js.
- Regras de datas, centavos, parcelas, pagamentos, autenticação e regressões estáticas terão cobertura.
- O backend real e a planilha real não serão usados durante os testes.
- As mudanças serão mantidas no branch atual e registradas em commits locais, deixando o diretório solicitado pronto para revisão e deploy.

## Decisões tomadas durante a implementação

- Leituras autenticadas também passam a usar `POST`, para que tokens não apareçam em URLs, históricos ou logs. O `GET` foi mantido somente como compatibilidade temporária do backend.
- Cache “fresco” foi reduzido de 24 horas para 5 minutos e, mesmo quando exibido imediatamente, é confirmado em segundo plano. Sem “manter conectada”, dados e token ficam apenas na sessão da aba.
- Pagamento parcial sem parcela selecionada é aplicado às parcelas abertas mais antigas: quita as que couberem e reduz o valor da próxima. Assim, a soma das parcelas continua igual ao saldo.
- Concluir atendimento e registrar a entrada no caixa virou uma única operação protegida no backend. Se uma etapa falhar, o agendamento volta ao estado anterior.
- Criação de fiado, recebimentos e baixas financeiras usam identificadores de operação para impedir duplicidade em reenvios ou respostas de rede perdidas.
- A visualização mensal da agenda em celular passa a ter rolagem horizontal legível, em vez de comprimir nomes e horários para fontes muito pequenas.
- Exclusões em cascata de fiado e planejamento restauram as linhas anteriores se uma gravação intermediária falhar.
- Parâmetros de data e período das consultas são validados no backend; intervalos invertidos e datas impossíveis são rejeitados com mensagem compreensível.
- Foi mantido um servidor local de demonstração com dados fictícios (`npm run preview:fixture`) para revisar telas e fluxos sem usar senha, planilha ou dados reais.
- A inspeção visual foi feita em 1280×720 e 390×844. Não houve erro de navegador nem rolagem lateral da página; o calendário usa rolagem própria, diálogos têm nome acessível, o foco começa no primeiro campo e permanece dentro do diálogo ao usar Tab.
- O código será integrado ao branch principal local depois da verificação final. Não será publicado automaticamente em produção, porque a solicitação não definiu um alvo de deploy e publicar mudaria o sistema ao vivo; a versão ficará pronta para esse passo após a revisão do Luciano.

## Central de Relacionamento

- A fila de retorno próximo começa 7 dias antes da data recomendada. A recuperação começa no 15º dia de atraso; antes desses limites a oportunidade permanece fora da fila operacional correspondente.
- As únicas etapas operacionais expostas são `contatada`, `respondeu`, `agendou` e `retornou`. `pendente` é o estado inicial técnico e encerramentos automáticos preservam histórico sem criar uma quinta ação manual.
- Os contatos comerciais da Central continuam assistidos: a operadora revisa a mensagem, abre o WhatsApp e confirma o envio; somente essa confirmação registra `contatada`. Os lembretes do próprio agendamento passam a ter automação separada, auditável e configurável.
- O vínculo automático de um novo agendamento prioriza: oportunidade explícita escolhida pela operadora, retorno previamente contatado e, por último, outras origens elegíveis. Um agendamento espontâneo encerra pendências concorrentes sem contar conversão indevida.
- Concluir agenda e caixa continua sendo o núcleo transacional. Se a atualização do relacionamento falhar depois do núcleo concluído, o sistema mantém atendimento e lançamento financeiro e mostra um aviso não destrutivo para correção posterior.
- Uma recomendação de retorno é obrigatória ao concluir o atendimento, salvo quando a operadora marcar explicitamente “sem retorno recomendado”. Repetir a mesma conclusão não duplica a oportunidade.
- Clientes com opt-out ou WhatsApp inválido permanecem consultáveis como histórico/inaptos, mas não podem ser acionados e foram excluídos do público selecionável de campanhas.
- Aniversários em 29 de fevereiro usam 28 de fevereiro em anos não bissextos para manter uma oportunidade anual previsível.
- Em telas grandes, gavetas operacionais ficam centralizadas e limitadas a 720 px; no celular ocupam a largura disponível sem rolagem horizontal.

## Sincronização Agenda–Caixa e lembretes automáticos

- Agenda e Caixa passam a compartilhar cliente, nome, serviço/descrição e valor quando o lançamento financeiro nasceu de um atendimento. Data do caixa e data/hora da agenda permanecem independentes para não alterar o regime financeiro escolhido na conclusão.
- O vínculo técnico `agcash:<agendamentoId>` é preservado pelo backend mesmo que uma edição antiga do navegador envie outro item. A sincronização não depende da tela que iniciou a mudança.
- Excluir pelo Caixa ou pela Agenda produz a mesma cascata: arquiva o agendamento, o caixa vinculado e o retorno futuro originado por ele; cancela o lembrete ainda pendente e desfaz o vínculo da oportunidade anterior sem apagar seu histórico.
- A listagem da Central trata como encerrado qualquer retorno cuja agenda de origem já tenha sido excluída. Essa defesa cobre também inconsistências antigas.
- Telefones importados são comparados e salvos em forma brasileira canônica. `+55 55 92...`, `+55 92...` e `(92)...` passam a representar o mesmo número; entradas inválidas não são apagadas e ficam disponíveis em **Telefones para revisar**.
- Foi escolhida a API oficial do WhatsApp Business Cloud. Conectores não oficiais foram descartados por risco de instabilidade e bloqueio do número.
- Mensagens iniciadas pelo salão usam modelo aprovado na Meta. A tela permite revisar a mensagem e sua prévia, mas qualquer mudança de texto precisa ser refletida e aprovada no modelo da Meta; criação e aprovação automática do modelo ficaram fora do escopo.
- A antecedência padrão é 4 horas, com opção de 3 horas. O envio ocorre somente no dia do atendimento, nunca antes da abertura e nunca no horário ou depois do início. Se o horário calculado cair antes da abertura, usa-se a abertura; se a abertura não anteceder o atendimento, não há envio automático.
- Uma fila `lembretes_envios` registra programação, tentativa, identificador devolvido pela Meta, erro sanitizado e estado final. A chave inclui agendamento, data e hora para impedir duplicidade; reagendamento cancela a chave antiga.
- O processador roda a cada 15 minutos, tenta no máximo três vezes e só marca `enviado` quando a Meta devolve o identificador da mensagem. Agendamentos cancelados, concluídos ou excluídos, clientes com bloqueio e telefones inválidos não são elegíveis.
- O token da Meta fica somente em `ScriptProperties`. A planilha, o frontend, a resposta da API e o histórico recebem apenas a indicação de que existe um token, nunca seu valor.
- A automação é implantada desativada e não pode ser ligada sem ID do número, token e nome de modelo. Nenhuma mensagem foi enviada para clientes reais nos testes ou na revisão visual.
- O botão **Testar conexão** apenas consulta os dados do número. O botão **Verificar e enviar agora** processa a fila e pode enviar mensagens reais quando a automação estiver ativa; essa diferença foi mantida explícita na interface e na documentação.
- A nova seção foi validada em 390×844 e 1440×900, sem rolagem horizontal, com prévia ao vivo, edição direta de telefone e largura de leitura limitada no desktop.

## DRE gerencial anual

- A DRE usa regime de caixa e somente linhas ativas da aba `caixa`. Parcelas futuras, obrigações planejadas e fiados ainda não recebidos ficam fora até gerarem um lançamento efetivo.
- O relatório é gerencial e não será apresentado como demonstração contábil oficial.
- Todos os valores são convertidos e agregados em centavos inteiros; subtotais, total anual, detalhe e conciliação não usam ponto flutuante monetário.
- Retiradas dos proprietários ficam fora do resultado líquido gerencial. Elas aparecem separadamente e reduzem apenas o “resultado após retiradas”.
- Categorias genéricas ou ambíguas não recebem inferência silenciosa: entram em `nao_classificado` e tornam a DRE provisória até revisão humana.
- `fora_dre` só pode ser aplicado por classificação ou padrão explícito. A categoria exclui o movimento do relatório, mas não altera nem apaga o lançamento original.
- A reclassificação grava somente `dreCategoria` e `atualizadoEm`; data, tipo, valor, pagamento e histórico financeiro permanecem intactos.
- Um padrão futuro precisa ter pelo menos um critério e pode ser desativado. Padrões desativados, seja como booleano ou texto da planilha, nunca são aplicados.
- Lançamentos excluídos são ignorados tanto pela leitura ativa do backend quanto pelo motor puro, como proteção adicional.
- A conciliação técnica é calculada por dois caminhos independentes: variação bruta elegível do Caixa e resultado após retiradas somado ao saldo não classificado. Qualquer diferença fica visível.
- O relatório anual não inclui comparação entre anos nesta entrega. A prioridade foi garantir um único ano auditável, com janeiro a dezembro, total, melhor/pior mês e detalhamento exato.
- A resposta anual não envia movimentos brutos ao navegador. Os lançamentos são consultados somente ao abrir uma linha e um mês válidos.
- A tela usa tabela horizontal com primeira coluna fixa no celular e gráfico SVG local, sem biblioteca ou código carregado por rede.

## Riscos residuais aceitos

- Apps Script + senha compartilhada continua sendo menos robusto que autenticação individual com provedor de identidade.
- O frontend permanece majoritariamente em um arquivo grande; a reestruturação completa fica fora desta correção para reduzir risco.
- Operações no Google Sheets não oferecem transações ACID. Serão adicionadas validação, idempotência e rollback de melhor esforço, mas uma reescrita com banco transacional seria necessária para garantia absoluta.

## Ajustes decididos após a revisão independente

- Senhas legadas curtas, inclusive a antiga `1234`, poderão ser migradas para hash no primeiro login sem bloquear uma instalação existente. Senhas novas e trocas continuam exigindo 8 ou mais caracteres.
- Identificadores recebidos pela API passam por uma lista restrita de caracteres antes de qualquer consulta ou gravação na planilha.
- Falhas do serviço de cache não transformam uma gravação financeira já concluída em erro, evitando que um rollback deixe um lançamento órfão.
- Seletores de visualização e tipo ganharam estado acessível; senha tem rótulo associado e eventos/itens clicáveis foram convertidos em botões operáveis pelo teclado.
- A publicação deve ocorrer na ordem Apps Script → verificação → Vercel, mantendo as versões anteriores disponíveis para reversão.

## Ponto de retomada — Central de Relacionamento e DRE anual

Registro feito em 19/07/2026 após a janela de trabalho solicitada:

- As especificações foram aprovadas e estão nos commits `8e7621c` e `0230578` da `main`.
- A execução está isolada na branch `feature/relacionamento-dre`.
- Worktree: `C:\Users\LENOVO\Documents\SISTEMAS VIBECODE\SALÃO SONIA\SoniaCabralMega\.worktrees\relacionamento-dre`.
- O primeiro bloco da Central foi concluído no commit `d1baff8`: regras puras de telefone, filas de 7/15 dias, prioridade de vínculo e indicadores com tempos médios.
- A suíte passou de 36 para 42 testes; `npm test` está com 42 aprovações e zero falhas.
- Nenhuma rota, tela, planilha, implantação do Apps Script ou publicação da Vercel foi alterada nesta branch até este ponto.
- Próxima tarefa: **Task 2 — Schemas, eventos e contratos autenticados**, no plano `docs/superpowers/plans/2026-07-19-central-relacionamento-implementation.md`.
- Depois de concluir as seis tarefas da Central, executar o plano `docs/superpowers/plans/2026-07-19-dre-gerencial-anual-implementation.md`.
- Antes de retomar: entrar na worktree, executar `git status --short` e `npm test`; a base esperada é limpa e com 42 testes aprovados.
- Não fazer `clasp push`, nova implantação do Apps Script, merge na `main` ou deploy da Vercel antes de concluir e verificar os dois módulos.

## Atualização de retomada — Central concluída

- As seis tarefas da Central de Relacionamento foram implementadas nos commits `d1baff8`, `a3eb49d`, `4e9244e`, `b9409f5` e `beeda9d` da branch `feature/relacionamento-dre`.
- A suíte está com 64 testes aprovados e zero falhas após a interface completa.
- A inspeção real foi repetida em 390×844 e 1280×900: sem rolagem lateral, público de campanha restrito a clientes elegíveis e gaveta de desktop com 720 px.
- Próxima tarefa: executar `docs/superpowers/plans/2026-07-19-dre-gerencial-anual-implementation.md`.
- Apps Script, implantação, Vercel, merge e GitHub continuam pendentes até a DRE anual e a verificação conjunta ficarem concluídas.

## Atualização de retomada — DRE concluída

- O motor, a persistência, as rotas, o detalhamento e a interface anual foram implementados nos commits `ae3f837`, `8d88137`, `35dde77`, `2014a12` e `0002bba`.
- A suíte está com 84 testes aprovados e zero falhas antes da documentação final.
- A validação real confirmou tabela sem rolagem lateral da página em 390×844 e 1280 px, primeira coluna fixa, mês negativo, total anual, aviso provisório, conciliação zerada e detalhe de janeiro fechando em R$ 2.400,00.
- Caixa e Extrato mensais continuaram com sua navegação e resultados do fixture sem regressão observável.
- Próxima etapa: verificação conjunta, integração na `main`, envio do Apps Script, nova implantação, publicação da Vercel e push para o GitHub, nesta ordem.

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

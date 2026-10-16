# uSampas LIVE 💜

**Versão separada para Netlify + Render:** leia `GUIA-DEPLOY-NETLIFY.txt` para os passos atualizados. O `server.js` desta pasta aceita `ALLOWED_ORIGINS` para liberar o domínio do Netlify.


Site de salas em tempo real para compartilhar tela, câmera, microfone e chat. Projeto original inspirado no conceito de salas de convivência — identidade uSampas em preto, branco e roxo neon.

## Começar no computador

Requisitos: **Node.js 20+**. Não há dependências NPM externas.

1. Extraia o ZIP.
2. Abra um terminal dentro da pasta `usampas-live`.
3. Execute `npm start`.
4. Abra **http://localhost:3000** no Chrome ou Edge.
5. Crie uma sala. Para testar com amigos, publique num servidor HTTPS.

Dica: `npm run dev` reinicia o servidor ao editar os arquivos.

## Publicar gratuitamente / de forma simples

A aplicação exige **um servidor Node.js** para controlar salas, convites, chat e a sinalização WebRTC. **Não basta arrastar os arquivos para Netlify Drop**: hospedagem estática sozinha não fornece o backend.

Um caminho de publicação é usar o Render:

1. Coloque toda a pasta num repositório GitHub.
2. Em https://dashboard.render.com/ crie **New > Web Service** conectado ao repositório (ou use o Blueprint `render.yaml`).
3. Configure **Node**, `npm install` e `npm start`.
4. O Render atribuirá uma URL **HTTPS**. Abra e crie uma sala. Compartilhe o link com seus amigos.
5. Utilize **uma instância** do servidor. A edição é demonstrativa e o estado de salas fica em memória.

A disponibilidade de planos gratuitos e os limites de hospedagem dependem do provedor.

## Funcionalidades

- Landing page responsiva, com interface premium roxo/black/white.
- Salas públicas (listadas) ou privadas (somente com link).
- Até 6 participantes por sala por padrão (variável de ambiente `MAX_PEOPLE`).
- Voz, vídeo e compartilhamento de tela por **WebRTC** entre os navegadores.
- Áudio da aba/tela, quando o navegador disponibiliza uma faixa de áudio na captura.
- Chat em tempo real com histórico temporário das últimas 40 mensagens.
- Reações, convites, pin de tela, tela cheia e modo galeria.
- Qualidade econômica como padrão: webcam 360p/15fps, transmissão de tela com alvo 15fps.
- Sem base de dados, serviço terceirizado de chamadas ou dependências JavaScript externas.

## Pontos importantes (para uso real)

- **WebRTC usa P2P em malha**: cada participante envia mídia para os outros; recomendado para grupos pequenos, não para dezenas/centenas de espectadores. O desempenho dependerá da qualidade da conexão e do hardware.
- Para usuários em redes restritivas ou NAT simétrico, **adicione um servidor TURN** configurando `ICE_SERVERS_JSON` no servidor (veja abaixo). Sem TURN algumas chamadas não conseguirão estabelecer conexão, embora chat e sala funcionem.
- Navegadores exigem **HTTPS** (ou `localhost`) para câmera, microfone e compartilhamento de tela; no celular o compartilhamento da própria tela pode ser indisponível.
- Salas, convidados e mensagens **ficam apenas na memória** e são perdidos ao reiniciar o servidor. Salas vazias expiram em 10 minutos.
- Não há contas, moderação persistente, criptografia de ponta a ponta do chat nem gravação: para expor a grandes comunidades adicione autenticação, rate limits mais robustos, validação anti-abuso, logs e persistência.
- Mídia WebRTC é criptografada no transporte (DTLS-SRTP); o servidor só transmite mensagens de sinalização e chat.
- Para muitas pessoas ou estabilidade de produção, considere arquitetura SFU (mediasoup/LiveKit/Janus) e TURN gerenciado, além de persistência em Redis/PostgreSQL.

### Configuração TURN (opcional, mas recomendada)

Configure `ICE_SERVERS_JSON` como JSON da lista de servidores ICE (os dados abaixo são exemplos e **não são credenciais válidas**):

```json
[
  { "urls": "stun:stun.l.google.com:19302" },
  { "urls": "turn:turn.seudominio.com:3478", "username": "USUARIO", "credential": "SENHA" }
]
```

No `Render`, cadastre esta variável em *Environment* em vez de escrever credenciais no código.

## Arquivos

```text
usampas-live/
├── package.json        # Node 20+ sem bibliotecas de terceiros
├── server.js           # HTTP + salas + API + sinalização por Server-Sent Events
├── render.yaml         # Blueprint opcional de publicação
├── public/
│   ├── index.html      # Landing + UI da sala + janelas de configuração
│   ├── styles.css      # Identidade visual e layout responsivo
│   ├── app.js          # Controle de mídia, salas, chat e WebRTC
│   └── favicon.svg
└── README.md
```

## Segurança e privacidade

As salas privadas não aparecem na listagem pública; qualquer pessoa com o link pode solicitar entrada. Todos começam com mic/câmera desligados. Mensagens são transmitidas através do servidor e não são criptografadas de ponta a ponta. Use HTTPS em produção.

**Criado para uSampas.**

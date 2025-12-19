# 💬 Resumo de Grupo WhatsApp

Um web app (PWA) que transforma centenas de mensagens de grupos do WhatsApp em resumos claros usando IA.

## ✨ Funcionalidades

- **Upload fácil**: Arraste e solte o arquivo .txt exportado do WhatsApp
- **Seleção de data**: Escolha qual dia deseja resumir em um calendário visual
- **4 níveis de resumo**: De ultra-resumido a completo com detalhes
- **3 modos de privacidade**: Anônimo, com nomes, ou inteligente
- **PWA instalável**: Funciona offline e aparece no menu "Compartilhar" do Android
- **100% gratuito**: Usa Groq AI (gratuito) para gerar resumos

## 🚀 Como usar

### Como usuário

1. Acesse o app no navegador
2. Exporte a conversa do WhatsApp:
   - Abra o grupo → ⋮ → Mais → Exportar conversa → Sem mídia
3. Arraste o arquivo .txt ou clique para fazer upload
4. Selecione a data que deseja resumir
5. Escolha o nível de detalhe e privacidade
6. Pronto! Copie ou compartilhe o resumo

### Instalando como PWA (Android)

1. Acesse o app no Chrome
2. Toque em ⋮ → "Instalar app" ou "Adicionar à tela inicial"
3. Agora o app aparece no menu "Compartilhar" quando você exporta uma conversa!

## 🛠️ Desenvolvimento

### Pré-requisitos

- Node.js 18+
- Conta no [Groq](https://console.groq.com) (gratuito)
- Vercel CLI (opcional, para desenvolvimento local)

### Instalação

```bash
# Clonar o repositório
git clone <repo-url>
cd groupResume

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Edite .env e adicione sua GROQ_API_KEY

# Rodar em desenvolvimento
npm run dev
```

### Estrutura do projeto

```
groupResume/
├── api/                    # Serverless functions (Vercel)
│   ├── upload.ts           # Recebe arquivo, extrai datas
│   ├── dates.ts            # Carrega mais datas
│   └── summarize.ts        # Gera resumo com IA
├── src/
│   ├── services/
│   │   ├── parser.ts       # Parser formato WhatsApp
│   │   ├── dateExtractor.ts
│   │   ├── chunker.ts      # Divide textos grandes
│   │   ├── groq.ts         # Cliente Groq API
│   │   └── store.ts        # Armazenamento temporário
│   └── types/
│       └── index.ts
├── public/
│   ├── index.html
│   ├── share.html          # Handler do Share Target
│   ├── manifest.json       # PWA config
│   ├── sw.js               # Service Worker
│   ├── app.js
│   └── styles.css
├── package.json
├── tsconfig.json
└── vercel.json
```

## 🚢 Deploy

### Vercel (Recomendado)

```bash
# Instalar Vercel CLI
npm i -g vercel

# Deploy
vercel

# Configurar variável de ambiente no dashboard do Vercel
# Settings → Environment Variables → GROQ_API_KEY
```

### Outras plataformas

O projeto é compatível com qualquer plataforma que suporte Node.js serverless functions.

## 🔒 Privacidade

- **Nenhum dado é armazenado permanentemente**
- Arquivos são processados em memória e descartados após 30 minutos
- Apenas o texto das mensagens é enviado para a IA (Groq) para gerar o resumo
- Não há login, cookies de rastreamento, ou analytics

## 📝 Licença

MIT

## 🤝 Contribuindo

Contribuições são bem-vindas! Abra uma issue ou pull request.


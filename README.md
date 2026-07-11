# Controle de Vídeo por Roteiro (MVP)

PWA que grava vídeo no celular guiado por um roteiro, com teleprompter, controle de tomadas e troca entre câmera frontal e traseira. Modo retrato.

## O que já funciona

- Upload de roteiro em `.txt` (formato de tomadas) ou `.json`.
- Lista das tomadas antes de gravar.
- Câmera ao vivo em tela cheia, com troca frontal/traseira (automática por tomada e manual).
- Teleprompter rolando por cima do preview, com velocidade e tamanho da fonte ajustáveis e opção de espelhar o texto.
- Contagem regressiva 3, 2, 1 antes de gravar.
- Timer da tomada com aviso ao passar da duração alvo.
- Marcar tomada como "boa" ou "refazer".
- Baixar o clipe gravado, nomeado pela tomada.
- Grade de enquadramento e trava de tela acesa (wake lock).
- Instalável como app (PWA) e funciona offline depois do primeiro acesso.

## Formato do roteiro

Um bloco por tomada. Exemplo em `roteiro-exemplo.txt`.

```
# Título da tomada
camera: traseira        (ou: frontal)
angulo: descrição livre do enquadramento e posição
duracao: 20s            (opcional, alvo de tempo)
---
Texto que vai rolar no teleprompter.
Pode ter várias linhas.
```

Alternativa em JSON:

```json
[
  { "titulo": "Abertura", "camera": "frontal", "angulo": "close", "duracao": "12s", "texto": "..." }
]
```

## Como rodar (precisa de HTTPS ou localhost para a câmera funcionar)

O navegador só libera a câmera em `https://` ou em `http://localhost`. Abrir o `index.html` com duplo clique (`file://`) **não** habilita a câmera.

### Opção A, servidor local para testar no PC

```powershell
cd C:\Users\prospera\Desktop\ControleDoVideoCelular
python -m http.server 8000
```

Depois abra `http://localhost:8000` no navegador.

### Opção B, testar no celular

Publique a pasta num host com HTTPS gratuito (Vercel, Netlify, Cloudflare Pages ou GitHub Pages) e abra o endereço no navegador do celular.

- No **Android**, use o Chrome.
- No **iPhone**, use o **Safari** (câmera não funciona em navegador embutido de outros apps).

## Limitações conhecidas do MVP

- Salvar o vídeo é por download. O navegador não grava direto em pastas do sistema.
- No iOS o formato de saída costuma ser `.mp4`; no Android, `.webm`.
- Controle fino de foco e zoom é limitado pelo navegador (fora do escopo do MVP).

## Próximo passo planejado

Adaptar o layout para **modo paisagem** depois que o modo retrato estiver validado.

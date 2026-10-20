# 🛡️ Discord Guard & League of Legends Community Bot

> **Bot Multifuncional para Servidores de League of Legends & Comunidades Gamer no Discord** — Gestão de Boas-Vindas, Invite Tracker, Consultas de Elo/Maestria em Tempo Real, Salas de Voz Temporárias, Sistema de XP/Honra e Auto-Moderação.

![Discord.js](https://img.shields.io/badge/Discord.js-v14.16-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![League of Legends](https://img.shields.io/badge/League_of_Legends-Community-C89B3C?style=for-the-badge&logo=leagueoflegends&logoColor=white)

---

## ✨ Principais Funcionalidades

### 🎮 Ecossistema League of Legends
- **`/elo` & Perfil de Invocador:** Consulta direta de Elo, PDL, Winrate, KDA e histórico recente no Discord.
- **`/campeao` & `/meucampeao`:** Estatísticas completas de campeões, builds recomendadas, ranking mundial/BR de jogadores com mais maestria e consulta personalizada do seu desempenho com qualquer campeão.
- **Sistema LFG (Procurando Grupo) & Clash:** Painéis interativos para fechar Duo, Flex, ARAM ou time de Clash com seleção de rota (Top, Jungle, Mid, ADC, Suporte).
- **Quiz de League of Legends:** Perguntas interativas no servidor valendo XP e pontos no ranking da comunidade.

### 🏆 Comunidade, XP & Honra (`GG`)
- **Progressão por Nível e XP:** Membros ganham XP automaticamente ao interagir nos canais de texto.
- **Sistema de Honra (`/honrar`):** Envie elogios *GG* para colegas de equipe após as partidas com controle de cooldown.
- **Ranking da Comunidade (`/rank`):** Leaderboard atualizado com níveis, mensagens, honras recebidas e vitórias no quiz.

### 🔊 Salas de Voz Temporárias (Join-to-Create)
- Criação automática de canais de voz personalizados (Duo, Trio, Full Party) assim que o membro entra no canal gerador.
- Exclusão automática da sala assim que o último membro sai, mantendo o servidor organizado.

### 🛡️ Segurança, Recepção & Administração
- **Boas-vindas & Invite Tracker:** Identifica automaticamente quem convidou cada novo membro e exibe o total de convites.
- **Auto-Role & Seleção de Cargos por Botões:** Entrega automática de cargo inicial e painéis de cargos por rota e elo.
- **Sistema de Tickets:** Abertura de canais privados de suporte com um clique.
- **Auto-Moderação & Logs de Auditoria:** Proteção anti-spam, anti-links e registro de mensagens apagadas/editadas.

---

## 🚀 Como Executar

1. Clone o repositório e instale as dependências:
   ```bash
   npm install
   ```
2. Copie o arquivo `.env.example` para `.env` e preencha suas credenciais:
   ```env
   DISCORD_TOKEN=SEU_TOKEN_AQUI
   GUILD_ID=ID_DO_SEU_SERVIDOR_AQUI
   ```
3. Inicie o bot:
   ```bash
   npm start
   ```

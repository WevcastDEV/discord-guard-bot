require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ChannelType
} = require('discord.js');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    const defaultConfig = {
      welcomeChannelId: null,
      leaveChannelId: null,
      logChannelId: null,
      lfgChannelId: null,
      clashChannelId: null,
      rulesChannelId: null,
      ticketCategoryId: null,
      autoRoleId: null,
      antiLink: false,
      antiSpam: true,
      lolMegaSetupDone: false
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let config = loadConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// Cache de convites para o Invite Tracker
const invitesCache = new Map();

// Cache para Anti-Spam
const spamTracker = new Map();

// Cache de Times de Clash / Personalizada
const clashTeams = new Map();

// Cache de Sessões de Draft (Bans & Picks): Map<messageId, { title, blueCaptain, redCaptain, blueBans: [], redBans: [] }>
const draftSessions = new Map();

// Cache de Salas de Voz Temporárias: Map<channelId, { ownerId, createdAt }>
const tempVoiceChannels = new Map();

function isTempVoiceChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice) return false;
  if (tempVoiceChannels.has(channel.id)) return true;
  return (
    channel.name.startsWith('🔊・Sala de ') ||
    channel.name.startsWith('🎮・Time de ') ||
    channel.name.startsWith('✨・')
  );
}

// Banco de Dados da Comunidade (XP, Nível, Honra GG, Riot ID vinculado, Quiz)
const COMMUNITY_PATH = path.join(__dirname, 'community_data.json');
function loadCommunity() {
  try {
    return JSON.parse(fs.readFileSync(COMMUNITY_PATH, 'utf8'));
  } catch (e) {
    const def = { users: {}, reputationCooldowns: {} };
    fs.writeFileSync(COMMUNITY_PATH, JSON.stringify(def, null, 2));
    return def;
  }
}
function saveCommunity(data) {
  fs.writeFileSync(COMMUNITY_PATH, JSON.stringify(data, null, 2));
}
let community = loadCommunity();

function getUserProfile(userId) {
  if (!community.users[userId]) {
    community.users[userId] = {
      xp: 0,
      level: 1,
      messages: 0,
      ggHonors: 0,
      quizWins: 0,
      riotId: null,
      region: 'br'
    };
  }
  return community.users[userId];
}

// Cooldown de XP por mensagem (evita flood ganhar XP)
const xpCooldown = new Map();

// Perguntas do Quiz de League of Legends
const LOL_QUIZ = [
  {
    q: 'Qual campeão é conhecido pelo título "O Imperador das Areias"?',
    options: ['Nasus', 'Renekton', 'Azir', 'Xerath'],
    answer: 2
  },
  {
    q: 'Qual é o nome da habilidade Ultimate (R) do Zed?',
    options: ['Sombra Viva', 'Marca Fatal', 'Lâmina Sombria', 'Corte Sombrio'],
    answer: 1
  },
  {
    q: 'Quantos acúmulos de Passiva a Annie precisa para atordoar (Stun) com sua próxima magia?',
    options: ['3 acúmulos', '4 acúmulos', '5 acúmulos', '6 acúmulos'],
    answer: 1
  },
  {
    q: 'Qual destes campeões é irmão de sangue do Darius?',
    options: ['Garen', 'Swain', 'Draven', 'Talon'],
    answer: 2
  },
  {
    q: 'Em qual minuto exato da partida o Barão Na\'Shor nasce em Summoner\'s Rift?',
    options: ['14:00', '15:00', '20:00', '25:00'],
    answer: 2
  },
  {
    q: 'Qual campeão fala a famosa frase: "A morte é como o vento: está sempre ao meu lado"?',
    options: ['Yone', 'Yasuo', 'Master Yi', 'Shen'],
    answer: 1
  },
  {
    q: 'Qual item concede o efeito Ativo "Estase" (deixa o campeão dourado e invulnerável por 2.5s)?',
    options: ['Anjo Guardião', 'Ampulheta de Zhonya', 'Véu da Banshee', 'Sinal de Sterak'],
    answer: 1
  },
  {
    q: 'Qual é a relação entre Jinx e Vi na história de Piltover e Zaun?',
    options: ['Primas', 'Rivais de infância', 'Irmãs', 'Mestre e Aprendiz'],
    answer: 2
  }
];

// Lista de Campeões do LoL por Rota
const LOL_CHAMPIONS = {
  TOP: ['Aatrox', 'Camille', 'Darius', 'Fiora', 'Garen', 'Gnar', 'Gwen', 'Illaoi', 'Irelia', 'Jax', 'Jayce', 'K\'Sante', 'Kayle', 'Kennen', 'Kled', 'Malphite', 'Mordekaiser', 'Nasus', 'Ornn', 'Pantheon', 'Poppy', 'Quinn', 'Renekton', 'Riven', 'Rumble', 'Sett', 'Shen', 'Singed', 'Sion', 'Teemo', 'Tryndamere', 'Urgot', 'Volibear', 'Yorick'],
  JG: ['Amumu', 'Bel\'Veth', 'Briar', 'Diana', 'Ekko', 'Elise', 'Evelynn', 'Fiddlesticks', 'Gragas', 'Graves', 'Hecarim', 'Ivern', 'Jarvan IV', 'Karthus', 'Kayn', 'Kha\'Zix', 'Kindred', 'Lee Sin', 'Lillia', 'Master Yi', 'Nidalee', 'Nocturne', 'Nunu e Willump', 'Olaf', 'Rammus', 'Rek\'Sai', 'Rengar', 'Sejuani', 'Shaco', 'Shyvana', 'Skarner', 'Taliyah', 'Udyr', 'Vi', 'Viego', 'Warwick', 'Wukong', 'Xin Zhao', 'Zac'],
  MID: ['Ahri', 'Akali', 'Akshan', 'Anivia', 'Annie', 'Aurelion Sol', 'Aurora', 'Azir', 'Cassiopeia', 'Corki', 'Fizz', 'Galio', 'Hwei', 'Kassadin', 'Katarina', 'LeBlanc', 'Lissandra', 'Lux', 'Malzahar', 'Naafiri', 'Neeko', 'Orianna', 'Qiyana', 'Ryze', 'Sylas', 'Syndra', 'Talon', 'Twisted Fate', 'Veigar', 'Vex', 'Viktor', 'Vladimir', 'Xerath', 'Yasuo', 'Yone', 'Zed', 'Ziggs', 'Zoe'],
  ADC: ['Aphelios', 'Ashe', 'Caitlyn', 'Draven', 'Ezreal', 'Jhin', 'Jinx', 'Kai\'Sa', 'Kalista', 'Kog\'Maw', 'Lucian', 'Miss Fortune', 'Nilah', 'Samira', 'Sivir', 'Smolder', 'Tristana', 'Twitch', 'Varus', 'Vayne', 'Xayah', 'Zeri'],
  SUP: ['Alistar', 'Bard', 'Blitzcrank', 'Brand', 'Braum', 'Janna', 'Karma', 'Leona', 'Lulu', 'Milio', 'Morgana', 'Nami', 'Nautilus', 'Pyke', 'Rakan', 'Rell', 'Renata Glasc', 'Senna', 'Seraphine', 'Sona', 'Soraka', 'Swain', 'Tahm Kench', 'Taric', 'Thresh', 'Vel\'Koz', 'Yuumi', 'Zilean', 'Zyra']
};

// Definições das Rotas, Elos e Modos para criação de cargos e botões
const LANE_ROLES = [
  { key: 'top', name: '🛡️ Top Laner', emoji: '🛡️', color: 0xe74c3c },
  { key: 'jg', name: '🌲 Jungler', emoji: '🌲', color: 0x2ecc71 },
  { key: 'mid', name: '🔮 Mid Laner', emoji: '🔮', color: 0x9b59b6 },
  { key: 'adc', name: '🏹 ADC / Bot', emoji: '🏹', color: 0xe67e22 },
  { key: 'sup', name: '❤️ Suporte', emoji: '❤️', color: 0x1abc9c }
];

const ELO_ROLES = [
  { key: 'ferro_bronze', name: '🥉 Ferro / Bronze', emoji: '🥉', color: 0x8d6e63 },
  { key: 'prata_ouro', name: '🥇 Prata / Ouro', emoji: '🥇', color: 0xf1c40f },
  { key: 'plat_esmeralda', name: '💚 Platina / Esmeralda', emoji: '💚', color: 0x2ecc71 },
  { key: 'diamante_plus', name: '💎 Diamante / Mestre+', emoji: '💎', color: 0x3498db },
  { key: 'clash_ready', name: '🏆 Jogo Clash', emoji: '🏆', color: 0xf39c12 }
];

const MODE_ROLES = [
  { key: 'x5_ready', name: '⚔️ Lobby X5 / Personalizada', emoji: '⚔️', color: 0xe74c3c },
  { key: 'duo_ready', name: '🤝 Procuro Duo / Flex', emoji: '🤝', color: 0x3498db },
  { key: 'aram_ready', name: '❄️ ARAM Lover', emoji: '❄️', color: 0x00bcd4 },
  { key: 'tft_ready', name: '🐧 TFT / Arena', emoji: '🐧', color: 0x9b59b6 }
];

// ==========================================
// DEFINIÇÃO DOS COMANDOS SLASH (/...)
// ==========================================
const commands = [
  // Comandos de League of Legends
  new SlashCommandBuilder()
    .setName('montar-clash')
    .setDescription('Abre uma escalação interativa de 5 vagas (TOP, JG, MID, ADC, SUP) para Clash ou Flex!')
    .addStringOption(opt => opt.setName('titulo').setDescription('Nome do time ou torneio (Ex: Clash de Sábado / Flex 5x5)').setRequired(true))
    .addStringOption(opt => opt.setName('tier').setDescription('Tier ou Elo alvo (Ex: Tier I, Tier II, Esmeralda+)').setRequired(true))
    .addStringOption(opt => opt.setName('horario').setDescription('Horário de início (Ex: Hoje às 19:30)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('procurar-duo')
    .setDescription('Publica um anúncio bonito procurando Duo, Flex ou Clash!')
    .addStringOption(opt => opt.setName('modo').setDescription('Qual fila você quer jogar?').setRequired(true).addChoices(
      { name: '🏆 Clash (Torneio)', value: '🏆 Clash' },
      { name: '⚔️ Ranked Solo/Duo', value: '⚔️ Ranked Solo/Duo' },
      { name: '🛡️ Ranked Flex 5v5', value: '🛡️ Ranked Flex 5v5' },
      { name: '❄️ ARAM / Normal Game', value: '❄️ ARAM / Normal' }
    ))
    .addStringOption(opt => opt.setName('sua-lane').setDescription('Em qual rota você joga?').setRequired(true).addChoices(
      { name: '🛡️ TOP', value: '🛡️ TOP' },
      { name: '🌲 JUNGLE', value: '🌲 JUNGLE' },
      { name: '🔮 MID', value: '🔮 MID' },
      { name: '🏹 ADC', value: '🏹 ADC' },
      { name: '❤️ SUPORTE', value: '❤️ SUPORTE' },
      { name: '🔄 Fill (Qualquer rota)', value: '🔄 Fill' }
    ))
    .addStringOption(opt => opt.setName('elo').setDescription('Seu Elo atual (Ex: Ouro II / Esmeralda IV)').setRequired(true))
    .addStringOption(opt => opt.setName('riotid').setDescription('Seu Nick#TAG no LoL (Ex: Faker#BR1)').setRequired(true))
    .addStringOption(opt => opt.setName('observacao').setDescription('Quem você procura? (Ex: Procuro Suporte de engage com mic)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('perfil-lol')
    .setDescription('Mostra Nível, Elo, Winrate e Maestrias de um jogador direto no Discord!')
    .addStringOption(opt => opt.setName('nick-tag').setDescription('Digite o Nick#TAG do jogador (Ex: Faker#BR1)').setRequired(true))
    .addStringOption(opt => opt.setName('regiao').setDescription('Servidor (Padrão: BR)').setRequired(false).addChoices(
      { name: '🇧🇷 Brasil (BR1)', value: 'br' },
      { name: '🇺🇸 América do Norte (NA1)', value: 'na' },
      { name: '🇪🇺 Europa Oeste (EUW1)', value: 'euw' },
      { name: '🇰🇷 Coreia (KR)', value: 'kr' }
    )),

  new SlashCommandBuilder()
    .setName('build')
    .setDescription('Busca as melhores Runas, Builds e Counters de um Campeão no patch atual!')
    .addStringOption(opt => opt.setName('campeao').setDescription('Nome do campeão (Ex: Yasuo, Ahri, Lee Sin, Jinx)').setRequired(true))
    .addStringOption(opt => opt.setName('lane').setDescription('Rota (opcional)').setRequired(false).addChoices(
      { name: '🛡️ Top', value: 'top' },
      { name: '🌲 Jungle', value: 'jungle' },
      { name: '🔮 Mid', value: 'mid' },
      { name: '🏹 ADC', value: 'adc' },
      { name: '❤️ Suporte', value: 'support' }
    )),

  new SlashCommandBuilder()
    .setName('counter')
    .setDescription('Descubra como ganhar daquele campeão chato na lane (Matchups, Dicas e Winrate)!')
    .addStringOption(opt => opt.setName('campeao').setDescription('Campeão inimigo que você quer counterar (Ex: Darius, Zed, Vayne)').setRequired(true))
    .addStringOption(opt => opt.setName('lane').setDescription('Rota (opcional)').setRequired(false).addChoices(
      { name: '🛡️ Top', value: 'top' },
      { name: '🌲 Jungle', value: 'jungle' },
      { name: '🔮 Mid', value: 'mid' },
      { name: '🏹 ADC', value: 'adc' },
      { name: '❤️ Suporte', value: 'support' }
    )),

  new SlashCommandBuilder()
    .setName('tierlist')
    .setDescription('Mostra a Tier List atualizada dos Campeões mais fortes (Meta Patch Atual) por rota!')
    .addStringOption(opt => opt.setName('lane').setDescription('Escolha a rota para ver os melhores campeões').setRequired(false).addChoices(
      { name: '🛡️ Top Lane', value: 'top' },
      { name: '🌲 Jungle', value: 'jungle' },
      { name: '🔮 Mid Lane', value: 'mid' },
      { name: '🏹 ADC / Bot', value: 'adc' },
      { name: '❤️ Suporte', value: 'support' }
    )),

  new SlashCommandBuilder()
    .setName('rank-campeao')
    .setDescription('Mostra o Ranking (Top BR e Top Mundo) dos melhores jogadores e Mono Champions de um campeão!')
    .addStringOption(opt => opt.setName('campeao').setDescription('Nome do campeão (Ex: Zed, Yasuo, Lee Sin, Katarina)').setRequired(true))
    .addStringOption(opt => opt.setName('nick-tag').setDescription('Opcional: Digite um Nick#TAG para ver se está no Top 100 BR/Mundo!').setRequired(false)),

  new SlashCommandBuilder()
    .setName('meu-campeao')
    .setDescription('Mostra todo o seu desempenho, Maestria, Winrate, KDA, Pentakills e Rank BR/Mundo com um campeão!')
    .addStringOption(opt => opt.setName('nick-tag').setDescription('Seu Riot ID com # (Ex: MeuNick#BR1)').setRequired(true))
    .addStringOption(opt => opt.setName('campeao').setDescription('Qual campeão você quer consultar? (Ex: Zed, Yasuo, Jinx)').setRequired(true))
    .addStringOption(opt => opt.setName('regiao').setDescription('Servidor (Padrão: BR)').setRequired(false).addChoices(
      { name: '🇧🇷 Brasil (BR1)', value: 'br' },
      { name: '🇺🇸 América do Norte (NA1)', value: 'na' },
      { name: '🇪🇺 Europa Oeste (EUW1)', value: 'euw' },
      { name: '🇰🇷 Coreia (KR)', value: 'kr' }
    )),

  // --- NOVOS COMANDOS DA COMUNIDADE & DIVERSÃO ---
  new SlashCommandBuilder()
    .setName('vincular-lol')
    .setDescription('Salva seu Riot ID (Nick#TAG) no seu perfil do Discord e já sincroniza seu cargo de Elo!')
    .addStringOption(opt => opt.setName('nick-tag').setDescription('Seu Riot ID completo (Ex: MeuNick#BR1)').setRequired(true))
    .addStringOption(opt => opt.setName('regiao').setDescription('Servidor (Padrão: BR)').setRequired(false).addChoices(
      { name: '🇧🇷 Brasil (BR1)', value: 'br' },
      { name: '🇺🇸 América do Norte (NA1)', value: 'na' },
      { name: '🇪🇺 Europa Oeste (EUW1)', value: 'euw' },
      { name: '🇰🇷 Coreia (KR)', value: 'kr' }
    )),

  new SlashCommandBuilder()
    .setName('honrar')
    .setDescription('Dê uma Honra (GG ❤️) para um membro que jogou bem, carregou ou foi gente boa!')
    .addUserOption(opt => opt.setName('membro').setDescription('Quem você quer honrar?').setRequired(true))
    .addStringOption(opt => opt.setName('motivo').setDescription('Por que ele merece GG? (Ex: Carregou o Clash / Zero rage)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('rank-servidor')
    .setDescription('Mostra o Cartão de Perfil na Comunidade (Nível, XP, Honras GG, Conta LoL) e o Top 10 do Servidor!')
    .addUserOption(opt => opt.setName('membro').setDescription('Membro para ver o perfil (opcional)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('quiz-lol')
    .setDescription('Inicia um Desafio Quiz de League of Legends com botões valendo +50 XP no servidor!'),

  new SlashCommandBuilder()
    .setName('duelo-1x1')
    .setDescription('Desafia outro membro para uma simulação épica de X1 (1v1) no Mid / Rio!')
    .addUserOption(opt => opt.setName('oponente').setDescription('Quem você quer desafiar pro X1?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('sugerir')
    .setDescription('Envia uma sugestão ou ideia para melhorar o servidor (com votação automática!)')
    .addStringOption(opt => opt.setName('ideia').setDescription('Descreva sua sugestão para o servidor').setRequired(true)),

  new SlashCommandBuilder()
    .setName('sala')
    .setDescription('Configura sua Sala de Voz Temporária (mudar nome, limite de vagas, trancar ou expulsar)!')
    .addStringOption(opt => opt.setName('nome').setDescription('Novo nome para sua sala temporária (Ex: Treino Clash / Resenha)').setRequired(false))
    .addIntegerOption(opt => opt.setName('limite').setDescription('Limite de pessoas (0 = Sem limite, 2 = Duo, 5 = Time)').setMinValue(0).setMaxValue(99).setRequired(false))
    .addBooleanOption(opt => opt.setName('trancar').setDescription('Trancar (true) ou Destrancar (false) a sala').setRequired(false))
    .addUserOption(opt => opt.setName('expulsar').setDescription('Desconectar um membro da sua sala temporária').setRequired(false)),

  new SlashCommandBuilder()
    .setName('patch-notes')
    .setDescription('Abre as Notas de Atualização (Patch Notes) oficiais do League of Legends e TFT!'),

  new SlashCommandBuilder()
    .setName('sortear-times')
    .setDescription('Sorteia 2 times (Azul vs Vermelho) com quem está na sua Call de Voz para X5!'),

  new SlashCommandBuilder()
    .setName('sortear-campeao')
    .setDescription('Sorteia um campeão aleatório (ou uma composição 5v5) para você jogar!')
    .addStringOption(opt => opt.setName('lane').setDescription('Escolha a rota ou deixe em branco para qualquer uma').setRequired(false).addChoices(
      { name: '🛡️ TOP', value: 'TOP' },
      { name: '🌲 JUNGLE', value: 'JG' },
      { name: '🔮 MID', value: 'MID' },
      { name: '🏹 ADC', value: 'ADC' },
      { name: '❤️ SUPORTE', value: 'SUP' },
      { name: '🔥 Composição Completa (5 Campeões)', value: 'COMP' }
    )),

  new SlashCommandBuilder()
    .setName('cara-ou-coroa')
    .setDescription('Sorteia Lado Azul vs Lado Vermelho (Side Selection) ou Cara/Coroa para X5 e Torneios!'),

  new SlashCommandBuilder()
    .setName('enquete')
    .setDescription('Cria uma votação rápida no servidor (Ex: Qual horário pro Clash / X5 hoje?)')
    .addStringOption(opt => opt.setName('pergunta').setDescription('Pergunta da enquete (Ex: Bora X5 hoje às 21h?)').setRequired(true)),

  // Comandos Administrativos e Utilitários
  new SlashCommandBuilder()
    .setName('setup-canais')
    .setDescription('Configura os canais de Boas-vindas, Saída, Logs e o Cargo Automático')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt => opt.setName('boas-vindas').setDescription('Canal onde serão enviadas as mensagens de entrada').setRequired(false))
    .addChannelOption(opt => opt.setName('saida').setDescription('Canal onde serão enviadas as mensagens de saída').setRequired(false))
    .addChannelOption(opt => opt.setName('logs').setDescription('Canal de auditoria (mensagens apagadas, editadas, voz, etc.)').setRequired(false))
    .addRoleOption(opt => opt.setName('autorole').setDescription('Cargo entregue automaticamente quando alguém entra no servidor').setRequired(false)),

  new SlashCommandBuilder()
    .setName('setup-automod')
    .setDescription('Ativa ou desativa proteções de moderação automática')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(opt => opt.setName('anti-link').setDescription('Bloquear links e convites de outros servidores (exceto Admins)').setRequired(false))
    .addBooleanOption(opt => opt.setName('anti-spam').setDescription('Bloquear envio de muitas mensagens seguidas (flood)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('painel-cargos')
    .setDescription('Envia um painel com botão interativo para membros pegarem/removerem um cargo')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(opt => opt.setName('cargo').setDescription('Qual cargo o botão vai entregar?').setRequired(true))
    .addStringOption(opt => opt.setName('titulo').setDescription('Título do painel').setRequired(true))
    .addStringOption(opt => opt.setName('descricao').setDescription('Texto explicando o cargo').setRequired(true))
    .addStringOption(opt => opt.setName('texto-botao').setDescription('Texto que aparece no botão (Ex: Pegar Cargo)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Apaga várias mensagens do chat de uma vez')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(opt => opt.setName('quantidade').setDescription('Quantidade de mensagens (1 a 100)').setMinValue(1).setMaxValue(100).setRequired(true)),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulsa um membro do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(opt => opt.setName('membro').setDescription('Membro a ser expulso').setRequired(true))
    .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da expulsão').setRequired(false)),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bane um membro do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(opt => opt.setName('membro').setDescription('Membro a ser banido').setRequired(true))
    .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do banimento').setRequired(false)),

  new SlashCommandBuilder()
    .setName('convites')
    .setDescription('Mostra quantos convites um membro possui no servidor')
    .addUserOption(opt => opt.setName('membro').setDescription('Membro para consultar (opcional)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('status-config')
    .setDescription('Mostra as configurações atuais do bot no servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('auto-estruturar')
    .setDescription('Cria e atualiza toda a estrutura de League of Legends no servidor!')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(cmd => cmd.toJSON());

// ==========================================
// HELPERS DE EMBEDS E PAINÉIS
// ==========================================
async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const codeMap = new Map();
    invites.forEach(inv => {
      codeMap.set(inv.code, {
        uses: inv.uses || 0,
        inviterId: inv.inviter ? inv.inviter.id : null
      });
    });
    invitesCache.set(guild.id, codeMap);
  } catch (err) {
    console.warn(`[AVISO] Não foi possível carregar convites de "${guild.name}".`);
  }
}

function buildClashEmbed(teamData) {
  const r = teamData.roles;
  const filledCount = Object.values(r).filter(Boolean).length;
  return new EmbedBuilder()
    .setColor(filledCount === 5 ? 0x2ecc71 : 0xf1c40f)
    .setTitle(`🏆 ESCALAÇÃO CLASH / 5v5: ${teamData.title} (${filledCount}/5)`)
    .setDescription('Clique no botão da sua **Rota (Lane)** abaixo para entrar ou sair da escalação do time!')
    .addFields(
      { name: '👑 Capitão', value: `<@${teamData.creatorId}>`, inline: true },
      { name: '🏅 Tier / Elo', value: `**${teamData.tier}**`, inline: true },
      { name: '⏰ Horário', value: `**${teamData.time}**`, inline: true },
      {
        name: '⚔️ Line-up (5 Jogadores)',
        value: [
          `🛡️ **TOP:** ${r.top ? `<@${r.top}>` : '*[Vaga Aberta - Clique abaixo]*'}`,
          `🌲 **JUNGLE:** ${r.jg ? `<@${r.jg}>` : '*[Vaga Aberta - Clique abaixo]*'}`,
          `🔮 **MID:** ${r.mid ? `<@${r.mid}>` : '*[Vaga Aberta - Clique abaixo]*'}`,
          `🏹 **ADC:** ${r.adc ? `<@${r.adc}>` : '*[Vaga Aberta - Clique abaixo]*'}`,
          `❤️ **SUPORTE:** ${r.sup ? `<@${r.sup}>` : '*[Vaga Aberta - Clique abaixo]*'}`
        ].join('\n'),
        inline: false
      }
    )
    .setFooter({ text: filledCount === 5 ? '✅ TIME FECHADO! Bom jogo em Summoner\'s Rift!' : 'Sistema de Escalação Automática • CLASH LOL' })
    .setTimestamp();
}

function buildClashButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('clash_slot_top').setLabel('TOP').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('clash_slot_jg').setLabel('JUNGLE').setEmoji('🌲').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('clash_slot_mid').setLabel('MID').setEmoji('🔮').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('clash_slot_adc').setLabel('ADC').setEmoji('🏹').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('clash_slot_sup').setLabel('SUP').setEmoji('❤️').setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('clash_leave').setLabel('Sair da Escalação').setEmoji('🚪').setStyle(ButtonStyle.Danger)
  );
  return [row1, row2];
}

// ==========================================
// MEGA AUTO-ESTRUTURAÇÃO DO SERVIDOR
// ==========================================
async function autoSetupGuild(guild, forceRebuildPanels = false) {
  try {
    await guild.roles.fetch();
    await guild.channels.fetch();

    // 1. Cargo Automático de Entrada (Auto-Role)
    let memberRole = guild.roles.cache.find(r => r.name.includes('Membro') || r.name.includes('Invocador'));
    if (!memberRole) {
      memberRole = await guild.roles.create({
        name: '⚔️ Invocador',
        colors: { primaryColor: 0x2ecc71 },
        reason: 'Auto-configuração LoL'
      });
    }

    // 2. Criar Cargos de Rotas (Lanes)
    const createdLaneRoles = [];
    for (const lane of LANE_ROLES) {
      let role = guild.roles.cache.find(r => r.name === lane.name);
      if (!role) {
        role = await guild.roles.create({
          name: lane.name,
          colors: { primaryColor: lane.color },
          reason: 'Cargos de Rota LoL'
        });
      }
      createdLaneRoles.push({ ...lane, id: role.id });
    }

    // 3. Criar Cargos de Elo + Clash
    const createdEloRoles = [];
    for (const elo of ELO_ROLES) {
      let role = guild.roles.cache.find(r => r.name === elo.name);
      if (!role) {
        role = await guild.roles.create({
          name: elo.name,
          colors: { primaryColor: elo.color },
          reason: 'Cargos de Elo LoL'
        });
      }
      createdEloRoles.push({ ...elo, id: role.id });
    }

    // 4. Criar Cargos de Modos de Jogo (X5, Duo, ARAM, TFT)
    const createdModeRoles = [];
    for (const mode of MODE_ROLES) {
      let role = guild.roles.cache.find(r => r.name === mode.name);
      if (!role) {
        role = await guild.roles.create({
          name: mode.name,
          colors: { primaryColor: mode.color },
          reason: 'Cargos de Modos LoL'
        });
      }
      createdModeRoles.push({ ...mode, id: role.id });
    }

    // 5. Categoria: 📌・RECEPÇÃO & GUIA (Remove duplicadas automaticamente!)
    const allInfoCategories = Array.from(
      guild.channels.cache.filter(
        c => c.type === ChannelType.GuildCategory && (c.name.includes('RECEP') || c.name.includes('GUIA'))
      ).values()
    );

    let infoCategory = allInfoCategories[0] || null;
    if (!infoCategory) {
      infoCategory = await guild.channels.create({
        name: '📌・RECEPÇÃO & GUIA',
        type: ChannelType.GuildCategory
      });
    } else if ( allInfoCategories.length > 1 ) {
      // Apaga todas as categorias "📌・RECEPÇÃO & GUIA" duplicadas!
      for (let i = 1; i < allInfoCategories.length; i++) {
        const dupCat = allInfoCategories[i];
        // Se tiver algum canal dentro da duplicada, move para a principal antes de deletar
        for (const [, ch] of guild.channels.cache.filter(c => c.parentId === dupCat.id)) {
          await ch.setParent(infoCategory.id).catch(() => {});
        }
        await dupCat.delete('Removendo categoria RECEPÇÃO & GUIA duplicada').catch(() => {});
      }
      console.log(`🧹 Removidas ${allInfoCategories.length - 1} categorias "RECEPÇÃO & GUIA" duplicadas!`);
    }

    // 5.1 Canal #👋・boas-vindas
    let welcomeChannel = guild.channels.cache.find(c => c.name.includes('boas-vindas') && c.type === ChannelType.GuildText);
    if (!welcomeChannel) {
      welcomeChannel = await guild.channels.create({
        name: '👋・boas-vindas',
        type: ChannelType.GuildText,
        parent: infoCategory.id
      });
    } else if (welcomeChannel.parentId !== infoCategory.id) {
      await welcomeChannel.setParent(infoCategory.id).catch(() => {});
    }

    // 5.2 Canal #📜・regras-e-comandos (MURAL MEGA COMPLETO COM REGRAS, COMANDOS, BOTÕES E GUIA)
    let rulesChannel = guild.channels.cache.find(c => c.name.includes('regras') && c.type === ChannelType.GuildText);
    if (!rulesChannel) {
      rulesChannel = await guild.channels.create({
        name: '📜・regras-e-comandos',
        type: ChannelType.GuildText,
        parent: infoCategory.id
      });
    } else if (rulesChannel.parentId !== infoCategory.id) {
      await rulesChannel.setParent(infoCategory.id).catch(() => {});
    }

    // 5.3 Canal #🎭・cargos
    let rolesChannel = guild.channels.cache.find(c => c.name.includes('cargos') && c.type === ChannelType.GuildText);
    if (!rolesChannel) {
      rolesChannel = await guild.channels.create({
        name: '🎭・cargos',
        type: ChannelType.GuildText,
        parent: infoCategory.id
      });
    } else if (rolesChannel.parentId !== infoCategory.id) {
      await rolesChannel.setParent(infoCategory.id).catch(() => {});
    }

    // 5.4 Canal #🎫・suporte-e-denuncias (Com botão de abrir Ticket privado!)
    let supportChannel = guild.channels.cache.find(c => c.name.includes('suporte') && c.type === ChannelType.GuildText);
    if (!supportChannel) {
      supportChannel = await guild.channels.create({
        name: '🎫・suporte-e-denuncias',
        type: ChannelType.GuildText,
        parent: infoCategory.id
      });

      const ticketEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🎫 Central de Suporte, Recrutamento & Denúncias — CLASH LOL')
        .setDescription([
          'Precisa falar em particular com a **Staff / Administração** do servidor?',
          '',
          '• 🚨 **Denunciar Rage / Troll / Toxicidade** em partidas ou calls',
          '• 🏆 **Inscrever ou registrar um Time Fixo de Clash**',
          '• 🤝 **Parcerias, Sugestões ou Dúvidas Gerais**',
          '',
          '👇 **Clique no botão abaixo para abrir uma sala privada de atendimento (Ticket)!**'
        ].join('\n'))
        .setFooter({ text: 'Atendimento Privado • CLASH LOL' });

      const ticketRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('open_ticket_btn')
          .setLabel('Abrir Ticket de Suporte / Denúncia')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Danger)
      );

      await supportChannel.send({ embeds: [ticketEmbed], components: [ticketRow] });
    } else if (supportChannel.parentId !== infoCategory.id) {
      await supportChannel.setParent(infoCategory.id).catch(() => {});
    }

    // 6. Categoria: 🏆・LEAGUE OF LEGENDS
    let lolCategory = guild.channels.cache.find(c => c.name.includes('LEAGUE OF LEGENDS') && c.type === ChannelType.GuildCategory);
    if (!lolCategory) {
      lolCategory = await guild.channels.create({
        name: '🏆・LEAGUE OF LEGENDS',
        type: ChannelType.GuildCategory
      });
    }

    // 6.1 Canal #🔍・procurar-duo-flex
    let lfgChannel = guild.channels.cache.find(c => c.name.includes('procurar-duo') && c.type === ChannelType.GuildText);
    if (!lfgChannel) {
      lfgChannel = await guild.channels.create({
        name: '🔍・procurar-duo-flex',
        type: ChannelType.GuildText,
        parent: lolCategory.id
      });
    }

    // 6.2 Canal #🏆・montar-time-clash
    let clashChannel = guild.channels.cache.find(c => c.name.includes('montar-time-clash') && c.type === ChannelType.GuildText);
    if (!clashChannel) {
      clashChannel = await guild.channels.create({
        name: '🏆・montar-time-clash',
        type: ChannelType.GuildText,
        parent: lolCategory.id
      });
    }

    // 6.3 Canal #⚔️・campeonatos-e-x5 (Com painel de sorteio rápido!)
    let x5Channel = guild.channels.cache.find(c => c.name.includes('campeonatos-e-x5') && c.type === ChannelType.GuildText);
    if (!x5Channel) {
      x5Channel = await guild.channels.create({
        name: '⚔️・campeonatos-e-x5',
        type: ChannelType.GuildText,
        parent: lolCategory.id
      });

      const x5Embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('⚔️ CENTRAL DE PERSONALIZADAS (X5) & SORTEIO DE TIMES')
        .setDescription([
          'Vai rolar **X5 / Partida Personalizada** entre a galera do servidor?',
          '',
          '1️⃣ Todo mundo entra na call **`❄️・ARAM / Lobby X5 (10)`**.',
          '2️⃣ Clique no botão **`🎲 Sortear Times da Call`** abaixo (ou use `/sortear-times`).',
          '3️⃣ O bot divide automaticamente os jogadores da call em **🔵 Time Azul vs 🔴 Time Vermelho** com as 5 rotas sorteadas!',
          '4️⃣ Use o botão **`🪙 Sortear Lado (Azul/Vermelho)`** para decidir quem tem o First Pick no Draft!'
        ].join('\n'))
        .setFooter({ text: 'Arena X5 • CLASH LOL' });

      const x5Row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('quick_x5_draw').setLabel('Sortear Times da Call').setEmoji('🎲').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('quick_side_coin').setLabel('Sortear Lado (Azul/Vermelho)').setEmoji('🪙').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('quick_comp_draw').setLabel('Sortear Composição 5v5').setEmoji('🔥').setStyle(ButtonStyle.Secondary)
      );

      await x5Channel.send({ embeds: [x5Embed], components: [x5Row] });
    }

    // 6.4 Canal #📊・builds-e-opgg
    let statsChannel = guild.channels.cache.find(c => c.name.includes('builds-e-opgg') && c.type === ChannelType.GuildText);
    if (!statsChannel) {
      statsChannel = await guild.channels.create({
        name: '📊・builds-e-opgg',
        type: ChannelType.GuildText,
        parent: lolCategory.id
      });
    }

    // 6.5 Canal #🎬・clipes-e-pentakills
    let clipsChannel = guild.channels.cache.find(c => c.name.includes('clipes-e-pentakills') && c.type === ChannelType.GuildText);
    if (!clipsChannel) {
      clipsChannel = await guild.channels.create({
        name: '🎬・clipes-e-pentakills',
        type: ChannelType.GuildText,
        parent: lolCategory.id
      });

      const clipsEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🎬 Mural de Clipes, Jogadas & Pentakills!')
        .setDescription('Fez aquele **Pentakill**, roubou o Barão ou deu um outplay absurdo? Poste seu print, vídeo ou link do Medal/YouTube aqui! O bot reage automaticamente com 🔥 e 🏆 em todas as plays!');
      await clipsChannel.send({ embeds: [clipsEmbed] });
    }

    // 6.6 Canal #📰・patch-notes-e-meta
    let patchChannel = guild.channels.cache.find(c => c.name.includes('patch-notes') && c.type === ChannelType.GuildText);
    if (!patchChannel) {
      patchChannel = await guild.channels.create({
        name: '📰・patch-notes-e-meta',
        type: ChannelType.GuildText,
        parent: lolCategory.id
      });

      const patchEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('📰 Central do Meta, Tier List & Notas de Atualização')
        .setDescription('Acompanhe os campeões mais fortes do patch atual (Tier S+) e as notas oficiais da Riot Games clicando nos botões abaixo ou usando `/tierlist` e `/patch-notes`!')
        .addFields(
          { name: '🏆 Tier List Geral (U.GG)', value: '[Ver Campeões S+ do Patch](https://u.gg/lol/tier-list)', inline: true },
          { name: '🇰🇷 Meta Coreano (OP.GG)', value: '[Ver Meta KR](https://www.op.gg/champions)', inline: true },
          { name: '📜 Patch Notes Oficial', value: '[Notas de Atualização Riot](https://www.leagueoflegends.com/pt-br/news/tags/patch-notes/)', inline: true }
        );

      const patchRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Tier List Patch Atual (U.GG)').setStyle(ButtonStyle.Link).setURL('https://u.gg/lol/tier-list').setEmoji('🏆'),
        new ButtonBuilder().setLabel('Notas de Atualização (Riot)').setStyle(ButtonStyle.Link).setURL('https://www.leagueoflegends.com/pt-br/news/tags/patch-notes/').setEmoji('📜'),
        new ButtonBuilder().setLabel('Simulador de Draft (Fearless/Pro)').setStyle(ButtonStyle.Link).setURL('https://draftlol.dawe.gg/').setEmoji('⚔️')
      );

      await patchChannel.send({ embeds: [patchEmbed], components: [patchRow] });
    }

    // 6B. NOVA CATEGORIA: 💬・COMUNIDADE & DIVERSÃO
    let communityCategory = guild.channels.cache.find(c => c.name.includes('COMUNIDADE') && c.type === ChannelType.GuildCategory);
    if (!communityCategory) {
      communityCategory = await guild.channels.create({
        name: '💬・COMUNIDADE & DIVERSÃO',
        type: ChannelType.GuildCategory
      });
    }

    // 6B.1 Canal #💬・chat-geral (Aproveita o #geral existente ou cria um novo)
    let generalChat = guild.channels.cache.find(c => (c.name === 'geral' || c.name.includes('chat-geral')) && c.type === ChannelType.GuildText);
    if (!generalChat) {
      generalChat = await guild.channels.create({
        name: '💬・chat-geral',
        type: ChannelType.GuildText,
        parent: communityCategory.id
      });
    } else {
      if (generalChat.name === 'geral') {
        await generalChat.setName('💬・chat-geral').catch(() => {});
      }
      if (generalChat.parentId !== communityCategory.id) {
        await generalChat.setParent(communityCategory.id).catch(() => {});
      }
    }

    // 6B.2 Canal #🖼️・memes-e-offtopic
    let memesChannel = guild.channels.cache.find(c => c.name.includes('memes-e-offtopic') && c.type === ChannelType.GuildText);
    if (!memesChannel) {
      memesChannel = await guild.channels.create({
        name: '🖼️・memes-e-offtopic',
        type: ChannelType.GuildText,
        parent: communityCategory.id
      });

      const memesEmbed = new EmbedBuilder()
        .setColor(0xe91e63)
        .setTitle('🖼️ Espaço de Memes, Skins & Off-Topic!')
        .setDescription('Mandou aquele meme de LoL, tirou skin Ultimate no baú Hextech ou quer conversar sobre outros jogos, animes e séries? Esse é o canal! O bot reage automaticamente nas imagens postadas aqui!');
      await memesChannel.send({ embeds: [memesEmbed] });
    }

    // 6B.3 Canal #🎖️・mural-de-honra-gg
    let honorChannel = guild.channels.cache.find(c => c.name.includes('mural-de-honra') && c.type === ChannelType.GuildText);
    if (!honorChannel) {
      honorChannel = await guild.channels.create({
        name: '🎖️・mural-de-honra-gg',
        type: ChannelType.GuildText,
        parent: communityCategory.id
      });

      const honorEmbed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('🎖️ MURAL DE HONRA (GG ❤️) DA COMUNIDADE')
        .setDescription([
          'Jogou com alguém do servidor que **carregou a partida**, **deu ótimas calls** ou **manteve a calma sem dar rage**?',
          '',
          '👉 Use o comando **`/honrar @membro motivo`** em qualquer canal!',
          '• O membro recebe **+1 Honra GG ❤️** e **+50 XP** no ranking do servidor!',
          '• Todas as honras ficam registradas neste mural público!'
        ].join('\n'))
        .setFooter({ text: 'Sistema de Reputação • CLASH LOL' });

      const honorRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('quick_rank_btn').setLabel('Ver Meu Perfil & Top 10 do Servidor').setEmoji('🏆').setStyle(ButtonStyle.Primary)
      );

      await honorChannel.send({ embeds: [honorEmbed], components: [honorRow] });
    }

    // 6B.4 Canal #💡・sugestoes
    let suggestionsChannel = guild.channels.cache.find(c => c.name.includes('sugestoes') && c.type === ChannelType.GuildText);
    if (!suggestionsChannel) {
      suggestionsChannel = await guild.channels.create({
        name: '💡・sugestoes',
        type: ChannelType.GuildText,
        parent: communityCategory.id
      });

      const sugEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('💡 Central de Ideias & Sugestões da Comunidade')
        .setDescription('Tem alguma ideia de campeonato X5, melhoria para o servidor ou novo comando para o bot?\n\nDigite **`/sugerir ideia:...`** e sua sugestão aparecerá aqui com votação aberta (✅ / ❌) para todos os membros!');
      await suggestionsChannel.send({ embeds: [sugEmbed] });
    }

    // 6B.5 Canal #🎮・minigames-e-quiz
    let minigamesChannel = guild.channels.cache.find(c => c.name.includes('minigames-e-quiz') && c.type === ChannelType.GuildText);
    if (!minigamesChannel) {
      minigamesChannel = await guild.channels.create({
        name: '🎮・minigames-e-quiz',
        type: ChannelType.GuildText,
        parent: communityCategory.id
      });

      const miniEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🎮 ARENA DE MINIGAMES, QUIZ LOL & DUELO 1X1')
        .setDescription([
          'Divirta-se enquanto espera a fila do LoL e ganhe **XP para subir de nível no servidor**:',
          '',
          '🧠 **Quiz de League of Legends (`/quiz-lol`)** — Responda perguntas sobre campeões, itens e lore clicando nos botões e ganhe **+50 XP**!',
          '⚔️ **Duelo X1 no Rio (`/duelo-1x1 @oponente`)** — Desafie um amigo para uma simulação de X1 com narração de outplay e ganhe **+30 XP**!',
          '🏆 **Ranking da Comunidade (`/rank-servidor`)** — Veja seu Nível, barra de XP, Honras GG e o Top 10 do servidor!',
          '',
          '👇 **Clique nos botões abaixo para jogar agora mesmo:**'
        ].join('\n'))
        .setFooter({ text: 'Minigames Interativos • CLASH LOL' });

      const miniRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('quick_quiz_btn').setLabel('Jogar Quiz LoL (+50 XP)').setEmoji('🧠').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('quick_rank_btn').setLabel('Ver Ranking & Meu Perfil').setEmoji('🏆').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('quick_comp_draw').setLabel('Sortear Composição 5v5').setEmoji('🎲').setStyle(ButtonStyle.Secondary)
      );

      await minigamesChannel.send({ embeds: [miniEmbed], components: [miniRow] });
    }

    // 6B.6 Canais de Voz da Comunidade (Incluindo Gerador de Sala Temporária + Resenha / AFK)
    const communityVoices = [
      { name: '➕・Criar Sala (Comunidade)', limit: 0 },
      { name: '🔊・Resenha / Barzinho #1', limit: 0 },
      { name: '🔊・Resenha / Barzinho #2', limit: 0 },
      { name: '🎵・Música / Chill', limit: 0 },
      { name: '💤・AFK / Dormindo', limit: 0 }
    ];
    for (const cv of communityVoices) {
      const exists = guild.channels.cache.find(c => c.name === cv.name && c.type === ChannelType.GuildVoice);
      if (!exists) {
        await guild.channels.create({
          name: cv.name,
          type: ChannelType.GuildVoice,
          parent: communityCategory.id,
          userLimit: cv.limit
        });
      }
    }

    // 7. Atualizar o Mural Completo em #📜・regras-e-comandos e #🎭・cargos
    if (!config.tempVoiceSetupDone || forceRebuildPanels) {
      // --- ATUALIZA #📜・regras-e-comandos COM 3 EMBEDS RICOS + BOTÕES ---
      const oldRulesMsgs = await rulesChannel.messages.fetch({ limit: 20 }).catch(() => null);
      if (oldRulesMsgs) {
        for (const [, m] of oldRulesMsgs.filter(msg => msg.author.id === client.user.id)) {
          await m.delete().catch(() => {});
        }
      }

      const rulesEmbed1 = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('📜 REGRAS OFICIAIS DO SERVIDOR — CLASH LOL')
        .setDescription('Seja muito bem-vindo(a) à nossa comunidade de **League of Legends**! Para manter um ambiente competitivo, organizado e sem toxicidade, siga nosso código do invocador:')
        .addFields(
          {
            name: '1️⃣ Respeito Acima de Tudo (Zero Rage / Toxicidade)',
            value: 'É proibido xingar, ofender, discriminar ou dar rage em colegas de equipe no chat ou nas calls de voz. Críticas construtivas sobre o jogo são válidas, ataques pessoais geram punição.'
          },
          {
            name: '2️⃣ Compromisso nos Times de Clash & X5',
            value: `Ao clicar em uma vaga de rota em ${clashChannel}, você assume compromisso com os outros 4 jogadores. Caso surja um imprevisto, clique no botão **🚪 Sair da Escalação** com antecedência.`
          },
          {
            name: '3️⃣ Proibido Spam, Flood e Divulgação Sem Permissão',
            value: 'Nosso bot **WCBOT** possui proteção **Anti-Spam** e **Anti-Link** ativa 24h. Enviar 5 mensagens seguidas em menos de 4 segundos aplica silenciamento (Timeout) automático.'
          },
          {
            name: '4️⃣ Salas de Voz Temporárias & Organização',
            value: 'Entre em **`➕・Criar Sala (Comunidade)`** ou **`➕・Criar Call LoL (Duo/Flex)`** para criar sua própria call automaticamente! Quando todo mundo sair da sala, ela desaparece sozinha.'
          },
          {
            name: '5️⃣ Problemas ou Denúncias?',
            value: `Vá até o canal ${supportChannel} e clique no botão **🎫 Abrir Ticket** para falar em particular com a Administração.`
          }
        );

      const rulesEmbed2 = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🤖 TODOS OS COMANDOS DO SERVIDOR (26 SLASH COMMANDS `/`)')
        .setDescription('Nosso bot exclusivo traz resultados em tempo real direto no Discord! Digite **`/`** em qualquer chat:')
        .addFields(
          {
            name: '💬 Comunidade, Salas Temporárias, Honra & Diversão',
            value: [
              '• **`/sala`** — Personaliza sua **Sala de Voz Temporária** (muda o nome, limite de vagas, tranca/destranca ou expulsa alguém da call)!',
              '• **`/vincular-lol`** — Salva seu `Nick#TAG` no Discord e **entrega automaticamente seu Cargo de Elo**!',
              '• **`/honrar`** — Dá **+1 Honra (GG ❤️)** e **+50 XP** para um membro que jogou bem e publica no Mural de Honra!',
              '• **`/rank-servidor`** — Mostra seu Cartão de Perfil (Nível, XP, Honras, Conta LoL) e o **Top 10 do Servidor**!',
              '• **`/quiz-lol`** e **`/duelo-1x1`** — Quiz interativo (+50 XP) e Simulador de X1 no Rio (+30 XP)!',
              '• **`/sugerir`** — Envia uma ideia com votação automática em `#💡・sugestoes`.'
            ].join('\n')
          },
          {
            name: '📊 Estatísticas em Tempo Real, Ranking BR/Mundo, Builds & Counters',
            value: [
              '• **`/perfil-lol`** — Mostra Nível, Elo Solo/Duo e Flex, Winrate, PDL e Maestrias direto no Discord!',
              '• **`/meu-campeao`** — Mostra sua Maestria, Jogos na Season, Winrate, KDA, CS, Pentakills e se você está no **Top 100 BR/Mundo**!',
              '• **`/rank-campeao`** — Exibe o **Top 10 Brasil** e **Top 10 Mundo** dos maiores Mono Champions de qualquer campeão!',
              '• **`/build`** — Mostra as Runas, Feitiços, Ordem de Skills e os 3 melhores combos de Itens do patch atual.',
              '• **`/counter`** — Mostra os 5 melhores campeões para counterar seu inimigo de lane + dicas de matchup.',
              '• **`/tierlist`** e **`/patch-notes`** — Top 10 Campeões Tier S+ por rota e notas oficiais da Riot.'
            ].join('\n')
          },
          {
            name: '🏆 Comandos de Clash, Times, X5 & Moderação',
            value: [
              '• **`/montar-clash`** — Abre escalação interativa com botões (`TOP`, `JG`, `MID`, `ADC`, `SUP`).',
              '• **`/procurar-duo`** — Publica cartão procurando Duo/Flex com seu Elo e Rota.',
              '• **`/sortear-times`**, **`/sortear-campeao`**, **`/cara-ou-coroa`**, **`/enquete`** — Ferramentas para X5 e torneios.',
              '• **`/convites`**, **`/clear`**, **`/kick`**, **`/ban`**, **`/auto-estruturar`** — Utilidades e Administração.'
            ].join('\n')
          }
        );

      const rulesEmbed3 = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🗺️ MAPA DOS CANAIS & SALAS TEMPORÁRIAS')
        .setDescription([
          '**📌 RECEPÇÃO & GUIA**',
          `• ${welcomeChannel} • ${rulesChannel} • ${rolesChannel} • ${supportChannel}`,
          '',
          '**💬 COMUNIDADE & DIVERSÃO**',
          `• ${generalChat} • ${memesChannel} • ${honorChannel} • ${suggestionsChannel} • ${minigamesChannel}`,
          `• 🔊 **\`➕・Criar Sala (Comunidade)\`** — Entre para criar sua sala de voz temporária na hora!`,
          '',
          '**🏆 LEAGUE OF LEGENDS**',
          `• ${lfgChannel} • ${clashChannel} • ${x5Channel} • ${statsChannel} • ${clipsChannel} • ${patchChannel}`,
          `• 🔊 **\`➕・Criar Call LoL (Duo/Flex)\`** — Cria uma call temporária para seu time (e some quando ficar vazia!)`
        ].join('\n'))
        .setFooter({ text: 'CLASH LOL • Clique nos botões abaixo para interagir!' });

      const quickLinksRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('quick_quiz_btn').setLabel('Jogar Quiz LoL (+50 XP)').setEmoji('🧠').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('quick_rank_btn').setLabel('Meu Perfil & Ranking').setEmoji('🏆').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('quick_comp_draw').setLabel('Sortear Composição 5v5').setEmoji('🎲').setStyle(ButtonStyle.Secondary)
      );

      await rulesChannel.send({ embeds: [rulesEmbed1, rulesEmbed2, rulesEmbed3], components: [quickLinksRow] });

      // --- ATUALIZA #🎭・cargos COM 3 PAINÉIS (ROTAS, ELOS, MODOS DE JOGO) ---
      const oldRoleMsgs = await rolesChannel.messages.fetch({ limit: 20 }).catch(() => null);
      if (oldRoleMsgs) {
        for (const [, m] of oldRoleMsgs.filter(msg => msg.author.id === client.user.id)) {
          await m.delete().catch(() => {});
        }
      }

      // Painel 1: Rotas
      const laneEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('⚔️ 1. ESCOLHA SUA ROTA (MAIN LANE)')
        .setDescription('Clique nos botões abaixo para exibir no seu perfil as rotas em que você joga:');

      const laneRow = new ActionRowBuilder();
      for (const l of createdLaneRoles) {
        laneRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`role_btn_${l.id}`)
            .setLabel(l.name.replace(/^[^\s]+\s/, ''))
            .setEmoji(l.emoji)
            .setStyle(ButtonStyle.Secondary)
        );
      }
      await rolesChannel.send({ embeds: [laneEmbed], components: [laneRow] });

      // Painel 2: Elos & Clash
      const eloEmbed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('🏆 2. ESCOLHA SEU ELO & ALERTA DE CLASH')
        .setDescription('Selecione seu **Elo atual** (ou use `/vincular-lol` para sincronizar automático!) e ative **🏆 Jogo Clash**:');

      const eloRow = new ActionRowBuilder();
      for (const e of createdEloRoles) {
        eloRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`role_btn_${e.id}`)
            .setLabel(e.name.replace(/^[^\s]+\s/, ''))
            .setEmoji(e.emoji)
            .setStyle(e.key === 'clash_ready' ? ButtonStyle.Success : ButtonStyle.Primary)
        );
      }
      await rolesChannel.send({ embeds: [eloEmbed], components: [eloRow] });

      // Painel 3: Modos de Jogo (X5, Duo, ARAM, TFT)
      const modeEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🎮 3. MODOS DE JOGO & NOTIFICAÇÕES DE FILA')
        .setDescription('Escolha quais modos você curte jogar para ser chamado quando a galera fechar lobby:');

      const modeRow = new ActionRowBuilder();
      for (const m of createdModeRoles) {
        modeRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`role_btn_${m.id}`)
            .setLabel(m.name.replace(/^[^\s]+\s/, ''))
            .setEmoji(m.emoji)
            .setStyle(ButtonStyle.Secondary)
        );
      }
      await rolesChannel.send({ embeds: [modeEmbed], components: [modeRow] });
    }

    // 8. Canais de Voz de LoL (Incluindo Gerador de Call Temporária + Calls Fixas)
    const voiceChannelsToCreate = [
      { name: '➕・Criar Call LoL (Duo/Flex)', limit: 0 },
      { name: '🏆・Time Clash #1 (5x5)', limit: 5 },
      { name: '🏆・Time Clash #2 (5x5)', limit: 5 },
      { name: '🛡️・Ranked Flex (5x5)', limit: 5 },
      { name: '🔵・X5 Time Azul (5x5)', limit: 5 },
      { name: '🔴・X5 Time Vermelho (5x5)', limit: 5 },
      { name: '⚔️・Solo / Duo #1 (2x2)', limit: 2 },
      { name: '⚔️・Solo / Duo #2 (2x2)', limit: 2 },
      { name: '❄️・ARAM / Lobby X5', limit: 10 }
    ];

    for (const vc of voiceChannelsToCreate) {
      const exists = guild.channels.cache.find(c => c.name === vc.name && c.type === ChannelType.GuildVoice);
      if (!exists) {
        await guild.channels.create({
          name: vc.name,
          type: ChannelType.GuildVoice,
          parent: lolCategory.id,
          userLimit: vc.limit
        });
      }
    }

    // 8B. Limpar qualquer sala temporária antiga que tenha ficado vazia
    for (const [, ch] of guild.channels.cache) {
      if (isTempVoiceChannel(ch)) {
        const humans = ch.members.filter(m => !m.user.bot).size;
        if (humans === 0) {
          await ch.delete('Limpeza de sala temporária vazia').catch(() => {});
        }
      }
    }

    // 9. Canal #📋・logs-auditoria (Privado)
    let logChannel = guild.channels.cache.find(c => c.name.includes('logs') && c.type === ChannelType.GuildText);
    if (!logChannel) {
      logChannel = await guild.channels.create({
        name: '📋・logs-auditoria',
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
          }
        ]
      });
    }

    config.welcomeChannelId = welcomeChannel.id;
    config.leaveChannelId = welcomeChannel.id;
    config.logChannelId = logChannel.id;
    config.lfgChannelId = lfgChannel.id;
    config.clashChannelId = clashChannel.id;
    config.rulesChannelId = rulesChannel.id;
    config.honorChannelId = honorChannel.id;
    config.suggestionsChannelId = suggestionsChannel.id;
    config.ticketCategoryId = infoCategory.id;
    config.autoRoleId = memberRole.id;
    config.lolMegaSetupDone = true;
    config.communitySetupDone = true;
    config.tempVoiceSetupDone = true;
    saveConfig(config);

    console.log(`🎉 Servidor "${guild.name}" turbinado com Salas Temporárias + Comunidade + League of Legends!`);
  } catch (err) {
    console.warn(`⚠️ Aviso ao auto-estruturar "${guild.name}": ${err.message}`);
  }
}

client.once('clientReady', async () => {
  console.log(`✅ Bot conectado como ${client.user.tag}!`);

  for (const [, guild] of client.guilds.cache) {
    await cacheGuildInvites(guild);
    await autoSetupGuild(guild);
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    if (process.env.GUILD_ID && client.guilds.cache.has(process.env.GUILD_ID)) {
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: [] }
      );
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`⚡ ${commands.length} Comandos Slash registrados instantaneamente no servidor (${process.env.GUILD_ID})!`);
    } else {
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
      );
      console.log(`🌐 Comandos Slash registrados globalmente!`);
    }
  } catch (err) {
    console.error('Erro ao registrar comandos Slash:', err);
  }
});

client.on('guildCreate', async guild => {
  await cacheGuildInvites(guild);
  await autoSetupGuild(guild);
});

client.on('inviteCreate', async invite => {
  if (!invite.guild) return;
  const guildInvites = invitesCache.get(invite.guild.id) || new Map();
  guildInvites.set(invite.code, {
    uses: invite.uses || 0,
    inviterId: invite.inviter ? invite.inviter.id : null
  });
  invitesCache.set(invite.guild.id, guildInvites);
});

client.on('inviteDelete', async invite => {
  if (!invite.guild) return;
  const guildInvites = invitesCache.get(invite.guild.id);
  if (guildInvites) guildInvites.delete(invite.code);
});

// ==========================================
// ENTRADA E SAÍDA DE MEMBRO + INVITE TRACKER
// ==========================================
client.on('guildMemberAdd', async member => {
  if (config.autoRoleId) {
    const role = member.guild.roles.cache.get(config.autoRoleId);
    if (role) {
      await member.roles.add(role).catch(() => {});
    }
  }

  let usedInvite = null;
  const cachedInvites = invitesCache.get(member.guild.id) || new Map();
  try {
    const currentInvites = await member.guild.invites.fetch();
    for (const [, inv] of currentInvites) {
      const prev = cachedInvites.get(inv.code);
      if (prev && inv.uses > prev.uses) {
        usedInvite = inv;
        break;
      }
    }
    await cacheGuildInvites(member.guild);
  } catch (e) {}

  if (config.welcomeChannelId) {
    const channel = member.guild.channels.cache.get(config.welcomeChannelId);
    if (channel && channel.isTextBased()) {
      const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
      let inviteText = 'Link direto / Não identificado';
      if (usedInvite && usedInvite.inviter) {
        inviteText = `<@${usedInvite.inviter.id}> (Código: \`${usedInvite.code}\` • **${usedInvite.uses}** usos)`;
      }

      const rolesChannel = member.guild.channels.cache.find(c => c.name.includes('cargos'));
      const rulesChannel = member.guild.channels.cache.find(c => c.name.includes('regras'));

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('⚔️ Um novo Invocador entrou em Summoner\'s Rift!')
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setDescription([
          `Seja muito bem-vindo(a) ao **${member.guild.name}**, ${member}!`,
          rulesChannel ? `📜 Leia o guia e os comandos em ${rulesChannel}` : '',
          rolesChannel ? `🎭 Escolha sua **Rota (Lane)** e seu **Elo** em ${rolesChannel}!` : ''
        ].filter(Boolean).join('\n'))
        .addFields(
          { name: '👤 Invocador', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
          { name: '📅 Conta criada há', value: `${accountAgeDays} dias`, inline: true },
          { name: '📨 Convidado por', value: inviteText, inline: false },
          { name: '📊 Total no Servidor', value: `Agora somos **${member.guild.memberCount}** invocadores!`, inline: false }
        )
        .setTimestamp();

      await channel.send({ content: `${member}`, embeds: [embed] }).catch(() => {});
    }
  }
});

client.on('guildMemberRemove', async member => {
  const channelId = config.leaveChannelId || config.welcomeChannelId;
  if (!channelId) return;

  const channel = member.guild.channels.cache.get(channelId);
  if (channel && channel.isTextBased()) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🚪 Um Invocador saiu do servidor')
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setDescription(`**${member.user.tag}** (\`${member.id}\`) desconectou da partida.`)
      .addFields({ name: '📊 Total de Membros', value: `Agora temos **${member.guild.memberCount}** membros.` })
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  }
});

// ==========================================
// LOGS DE AUDITORIA (MENSAGENS & CALLS DE VOZ)
// ==========================================
async function sendLog(guild, embed) {
  if (!config.logChannelId) return;
  const logChannel = guild.channels.cache.get(config.logChannelId);
  if (logChannel && logChannel.isTextBased()) {
    await logChannel.send({ embeds: [embed] }).catch(() => {});
  }
}

client.on('messageDelete', async message => {
  if (!message.guild || message.author?.bot) return;
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🗑️ Mensagem Apagada')
    .addFields(
      { name: '👤 Autor', value: message.author ? `${message.author} (\`${message.author.id}\`)` : 'Desconhecido', inline: true },
      { name: '💬 Canal', value: `${message.channel}`, inline: true },
      { name: '📝 Conteúdo', value: message.content ? message.content.slice(0, 1024) : '*[Sem texto / Anexo]*' }
    )
    .setTimestamp();
  await sendLog(message.guild, embed);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('✏️ Mensagem Editada')
    .setURL(newMessage.url)
    .addFields(
      { name: '👤 Autor', value: `${newMessage.author} (\`${newMessage.author.id}\`)`, inline: true },
      { name: '💬 Canal', value: `${newMessage.channel}`, inline: true },
      { name: '📄 Antes', value: oldMessage.content ? oldMessage.content.slice(0, 1024) : '*[Não estava em cache]*' },
      { name: '📝 Depois', value: newMessage.content ? newMessage.content.slice(0, 1024) : '*[Vazio]*' }
    )
    .setTimestamp();
  await sendLog(newMessage.guild, embed);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  // 1. SISTEMA DE SALAS TEMPORÁRIAS: Auto-Deletar quando ficar vazia!
  if (oldState.channel && oldState.channelId !== newState.channelId) {
    if (isTempVoiceChannel(oldState.channel)) {
      const remainingHumans = oldState.channel.members.filter(m => !m.user.bot).size;
      if (remainingHumans === 0) {
        tempVoiceChannels.delete(oldState.channel.id);
        await oldState.channel.delete('Sala temporária ficou vazia').catch(() => {});
      }
    }
  }

  // 2. SISTEMA DE SALAS TEMPORÁRIAS: "Join to Create" (Entrou em ➕・Criar Sala)
  if (newState.channel && newState.channelId !== oldState.channelId) {
    if (newState.channel.name.startsWith('➕・Criar')) {
      try {
        const isLolCall = newState.channel.name.includes('LoL');
        const cleanUser = (member.displayName || member.user.username).slice(0, 18);
        const roomName = isLolCall ? `🎮・Time de ${cleanUser}` : `🔊・Sala de ${cleanUser}`;
        const defaultLimit = isLolCall ? 5 : 0;

        const createdVoice = await member.guild.channels.create({
          name: roomName,
          type: ChannelType.GuildVoice,
          parent: newState.channel.parentId || null,
          userLimit: defaultLimit,
          permissionOverwrites: [
            {
              id: member.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.Stream,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.MoveMembers
              ]
            }
          ]
        });

        tempVoiceChannels.set(createdVoice.id, {
          ownerId: member.id,
          createdAt: Date.now()
        });

        // Move o membro para a sala recém-criada
        await member.voice.setChannel(createdVoice).catch(async () => {
          // Se o membro desconectou antes de ser movido, apaga a sala
          tempVoiceChannels.delete(createdVoice.id);
          await createdVoice.delete().catch(() => {});
        });

        // Envia um Painel de Controle Interativo dentro do chat da própria call!
        const controlEmbed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle(`🎛️ Painel da Sala Temporária — ${roomName}`)
          .setDescription([
            `👑 **Dono da Sala:** ${member}`,
            '✨ **Esta sala é temporária:** assim que todo mundo sair da call, ela será apagada automaticamente!',
            '',
            '👇 **Use os botões abaixo (ou o comando `/sala`) para controlar sua call:**'
          ].join('\n'))
          .setFooter({ text: 'Sistema de Salas Temporárias • CLASH LOL' })
          .setTimestamp();

        const controlRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`tempvc_lock_${createdVoice.id}`).setLabel('Trancar').setEmoji('🔒').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`tempvc_unlock_${createdVoice.id}`).setLabel('Destrancar').setEmoji('🔓').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`tempvc_limit2_${createdVoice.id}`).setLabel('Duo (2)').setEmoji('⚔️').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`tempvc_limit5_${createdVoice.id}`).setLabel('Time (5)').setEmoji('🏆').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`tempvc_limit0_${createdVoice.id}`).setLabel('Livre').setEmoji('♾️').setStyle(ButtonStyle.Secondary)
        );

        await createdVoice.send({ content: `${member}`, embeds: [controlEmbed], components: [controlRow] }).catch(() => {});
      } catch (err) {
        console.warn('Erro ao criar sala temporária:', err.message);
      }
      return;
    }
  }

  // 3. Logs de Auditoria de Voz
  if (!oldState.channelId && newState.channelId) {
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🔊 Entrou em Call de Voz')
      .setDescription(`${member} entrou em **${newState.channel.name}**`)
      .setTimestamp();
    await sendLog(member.guild, embed);
  } else if (oldState.channelId && !newState.channelId) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🔇 Saiu de Call de Voz')
      .setDescription(`${member} saiu de **${oldState.channel.name}**`)
      .setTimestamp();
    await sendLog(member.guild, embed);
  } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🔄 Trocou de Call de Voz')
      .setDescription(`${member} moveu de **${oldState.channel.name}** para **${newState.channel.name}**`)
      .setTimestamp();
    await sendLog(member.guild, embed);
  }
});

// ==========================================
// MENSAGENS, SISTEMA DE XP, CLIPES & AUTO-MOD
// ==========================================
client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  // 1. Reações automáticas em #🎬・clipes-e-pentakills e #🖼️・memes-e-offtopic
  if (message.channel.name && message.channel.name.includes('clipes-e-pentakills')) {
    await message.react('🔥').catch(() => {});
    await message.react('🏆').catch(() => {});
    await message.react('⚔️').catch(() => {});
  } else if (message.channel.name && message.channel.name.includes('memes-e-offtopic') && (message.attachments.size > 0 || message.content.includes('http'))) {
    await message.react('😂').catch(() => {});
    await message.react('🔥').catch(() => {});
  }

  // 2. Sistema de XP e Níveis da Comunidade
  const profile = getUserProfile(message.author.id);
  profile.messages = (profile.messages || 0) + 1;
  const lastXpTime = xpCooldown.get(message.author.id) || 0;
  if (Date.now() - lastXpTime > 25000) {
    xpCooldown.set(message.author.id, Date.now());
    const gainedXp = Math.floor(Math.random() * 11) + 15; // 15 a 25 XP
    profile.xp += gainedXp;
    const neededXp = profile.level * 100;
    if (profile.xp >= neededXp) {
      profile.level += 1;
      saveCommunity(community);
      const rankTitle =
        profile.level >= 20 ? '👑 Lenda Desafiante' :
        profile.level >= 10 ? '💎 Mestre da Comunidade' :
        profile.level >= 5 ? '🔥 Veterano da SoloQ' : '⚔️ Invocador em Ascensão';
      message.channel.send({
        content: `🎉 **LEVEL UP!** Parabéns ${message.author}, você subiu para o **Nível ${profile.level}** (${rankTitle}) na comunidade! Use \`/rank-servidor\` para ver seu progresso!`
      }).catch(() => {});
    } else {
      saveCommunity(community);
    }
  } else {
    saveCommunity(community);
  }

  if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  if (config.antiLink) {
    const linkRegex = /(https?:\/\/[^\s]+|discord\.gg\/[^\s]+|discordapp\.com\/invite\/[^\s]+)/i;
    if (linkRegex.test(message.content)) {
      await message.delete().catch(() => {});
      const warnMsg = await message.channel.send({
        content: `🚫 ${message.author}, o envio de links não é permitido neste servidor!`
      });
      setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      return;
    }
  }

  if (config.antiSpam) {
    const now = Date.now();
    const timestamps = spamTracker.get(message.author.id) || [];
    const recent = timestamps.filter(t => now - t < 4000);
    recent.push(now);
    spamTracker.set(message.author.id, recent);

    if (recent.length >= 5) {
      spamTracker.set(message.author.id, []);
      if (message.member?.moderatable) {
        await message.member.timeout(60 * 1000, 'Anti-Spam: Enviando mensagens rápido demais').catch(() => {});
      }
      const warnMsg = await message.channel.send({
        content: `⚠️ ${message.author}, sem spam no chat! Você recebeu um timeout de 1 minuto.`
      });
      setTimeout(() => warnMsg.delete().catch(() => {}), 6000);
    }
  }
});

// ==========================================
// INTERAÇÕES (BOTÕES E COMANDOS SLASH)
// ==========================================
client.on('interactionCreate', async interaction => {
  // 1. BOTÕES INTERATIVOS
  if (interaction.isButton()) {
    // A) Botão de Pegar/Remover Cargo (Lane, Elo, Modo)
    if (interaction.customId.startsWith('role_btn_')) {
      const roleId = interaction.customId.replace('role_btn_', '');
      const role = interaction.guild.roles.cache.get(roleId);

      if (!role) {
        return interaction.reply({ content: '❌ Este cargo não existe mais no servidor.', ephemeral: true });
      }

      const hasRole = interaction.member.roles.cache.has(roleId);
      try {
        if (hasRole) {
          await interaction.member.roles.remove(roleId);
          return interaction.reply({ content: `➖ Cargo **${role.name}** removido do seu perfil!`, ephemeral: true });
        } else {
          await interaction.member.roles.add(roleId);
          return interaction.reply({ content: `✅ Você recebeu o cargo **${role.name}**!`, ephemeral: true });
        }
      } catch (err) {
        return interaction.reply({
          content: '❌ Não consegui alterar seu cargo. Verifique a hierarquia de cargos do servidor!',
          ephemeral: true
        });
      }
    }

    // B) Botões de Escalação de Clash (TOP, JG, MID, ADC, SUP, Sair)
    if (interaction.customId.startsWith('clash_')) {
      let team = clashTeams.get(interaction.message.id);
      if (!team) {
        team = {
          creatorId: client.user.id,
          title: 'Time Clash / 5v5',
          tier: 'Livre',
          time: 'A definir',
          roles: { top: null, jg: null, mid: null, adc: null, sup: null }
        };
        clashTeams.set(interaction.message.id, team);
      }

      const userId = interaction.user.id;

      if (interaction.customId === 'clash_leave') {
        let removed = false;
        for (const k of ['top', 'jg', 'mid', 'adc', 'sup']) {
          if (team.roles[k] === userId) {
            team.roles[k] = null;
            removed = true;
          }
        }
        if (!removed) {
          return interaction.reply({ content: 'ℹ️ Você não estava inscrito em nenhuma rota desta escalação.', ephemeral: true });
        }
        await interaction.update({ embeds: [buildClashEmbed(team)], components: buildClashButtons() });
        return;
      }

      const slot = interaction.customId.replace('clash_slot_', '');
      if (team.roles[slot] && team.roles[slot] !== userId) {
        return interaction.reply({
          content: `❌ Essa rota já está ocupada por <@${team.roles[slot]}>! Escolha outra rota ou peça para trocarem.`,
          ephemeral: true
        });
      }

      for (const k of ['top', 'jg', 'mid', 'adc', 'sup']) {
        if (team.roles[k] === userId) {
          team.roles[k] = null;
        }
      }

      team.roles[slot] = userId;
      await interaction.update({ embeds: [buildClashEmbed(team)], components: buildClashButtons() });
      return;
    }

    // C) Botões de Sistema de Tickets Privados (#🎫・suporte-e-denuncias)
    if (interaction.customId === 'open_ticket_btn') {
      const cleanName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'invocador';
      const channelName = `🎫・ticket-${cleanName}`;

      const existing = interaction.guild.channels.cache.find(c => c.name === channelName && c.type === ChannelType.GuildText);
      if (existing) {
        return interaction.reply({
          content: `ℹ️ Você já possui um ticket aberto em ${existing}!`,
          ephemeral: true
        });
      }

      try {
        const ticketChannel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: config.ticketCategoryId || null,
          permissionOverwrites: [
            {
              id: interaction.guild.id,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: interaction.user.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
            }
          ]
        });

        const ticketWelcome = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle(`🎫 Atendimento Privado — ${interaction.user.tag}`)
          .setDescription([
            `Olá ${interaction.user}! Este canal é visível **apenas para você e para a Administração** do servidor.`,
            '',
            '📝 **Descreva abaixo o motivo do seu contato:**',
            '• Se for **denúncia de rage/troll**, envie o Nick/Discord da pessoa e prints se tiver.',
            '• Se for **registro de time de Clash** ou dúvida, escreva os detalhes.',
            '',
            'Quando o atendimento terminar, clique em **🔒 Fechar Ticket**.'
          ].join('\n'))
          .setTimestamp();

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_ticket_btn').setLabel('Fechar Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({ content: `${interaction.user}`, embeds: [ticketWelcome], components: [closeRow] });
        return interaction.reply({ content: `✅ Seu ticket privado foi criado em ${ticketChannel}!`, ephemeral: true });
      } catch (err) {
        return interaction.reply({ content: `❌ Erro ao criar ticket: ${err.message}`, ephemeral: true });
      }
    }

    if (interaction.customId === 'close_ticket_btn') {
      await interaction.reply({ content: '🔒 Fechando este ticket em 3 segundos...' });
      setTimeout(() => {
        interaction.channel.delete('Ticket encerrado').catch(() => {});
      }, 3000);
      return;
    }

    // D) Botões de Ação Rápida em #⚔️・campeonatos-e-x5 e #📜・regras-e-comandos
    if (interaction.customId === 'quick_x5_draw') {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({
          content: '❌ Entre primeiro em uma **Call de Voz** com a galera para sortear os times!',
          ephemeral: true
        });
      }
      const members = Array.from(voiceChannel.members.values()).filter(m => !m.user.bot);
      if (members.length < 2) {
        return interaction.reply({
          content: '❌ Precisa haver pelo menos **2 jogadores** na sua call de voz para sortear os times!',
          ephemeral: true
        });
      }
      for (let i = members.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [members[i], members[j]] = [members[j], members[i]];
      }
      const half = Math.ceil(members.length / 2);
      const blueTeam = members.slice(0, half);
      const redTeam = members.slice(half);
      const lanesOrder = ['🛡️ TOP', '🌲 JG', '🔮 MID', '🏹 ADC', '❤️ SUP'];

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(`🎲 Sorteio de Times (X5) — ${voiceChannel.name}`)
        .addFields(
          {
            name: `🔵 TIME AZUL (${blueTeam.length})`,
            value: blueTeam.map((m, idx) => `${lanesOrder[idx] ? `**${lanesOrder[idx]}:** ` : '• '}${m}`).join('\n') || 'Nenhum',
            inline: true
          },
          {
            name: `🔴 TIME VERMELHO (${redTeam.length})`,
            value: redTeam.map((m, idx) => `${lanesOrder[idx] ? `**${lanesOrder[idx]}:** ` : '• '}${m}`).join('\n') || 'Nenhum',
            inline: true
          }
        )
        .setFooter({ text: `Sorteado por ${interaction.user.tag}` })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.customId === 'quick_side_coin') {
      const isBlue = Math.random() < 0.5;
      const embed = new EmbedBuilder()
        .setColor(isBlue ? 0x3498db : 0xe74c3c)
        .setTitle('🪙 Sorteio de Lado do Mapa (Side Selection)')
        .setDescription(
          isBlue
            ? '🔵 **LADO AZUL (BLUE SIDE / FIRST PICK)** venceu o sorteio!'
            : '🔴 **LADO VERMELHO (RED SIDE / COUNTER PICK)** venceu o sorteio!'
        )
        .setFooter({ text: `Sorteado por ${interaction.user.tag}` })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.customId === 'quick_comp_draw') {
      const pick = arr => arr[Math.floor(Math.random() * arr.length)];
      const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('🔥 Composição 5v5 Sorteada!')
        .setDescription(`Composição gerada para ${interaction.user}:`)
        .addFields(
          { name: '🛡️ TOP', value: `**${pick(LOL_CHAMPIONS.TOP)}**`, inline: true },
          { name: '🌲 JUNGLE', value: `**${pick(LOL_CHAMPIONS.JG)}**`, inline: true },
          { name: '🔮 MID', value: `**${pick(LOL_CHAMPIONS.MID)}**`, inline: true },
          { name: '🏹 ADC', value: `**${pick(LOL_CHAMPIONS.ADC)}**`, inline: true },
          { name: '❤️ SUPORTE', value: `**${pick(LOL_CHAMPIONS.SUP)}**`, inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // E) Botões da Comunidade: Quiz LoL e Ranking Rápido
    if (interaction.customId === 'quick_quiz_btn') {
      const qIdx = Math.floor(Math.random() * LOL_QUIZ.length);
      const qItem = LOL_QUIZ[qIdx];
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🧠 DESAFIO QUIZ LEAGUE OF LEGENDS (+50 XP)')
        .setDescription(`### ${qItem.q}\n\nClique na resposta correta abaixo! O primeiro a acertar ganha **+50 XP** no servidor!`)
        .setFooter({ text: `Iniciado por ${interaction.user.tag}` })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        qItem.options.map((optText, idx) =>
          new ButtonBuilder()
            .setCustomId(`quiz_ans_${qIdx}_${idx}`)
            .setLabel(optText)
            .setStyle(ButtonStyle.Primary)
        )
      );
      return interaction.reply({ embeds: [embed], components: [row] });
    }

    if (interaction.customId.startsWith('quiz_ans_')) {
      const parts = interaction.customId.split('_');
      const qIdx = Number(parts[2]);
      const chosenIdx = Number(parts[3]);
      const qItem = LOL_QUIZ[qIdx];
      if (!qItem) return interaction.reply({ content: '❌ Pergunta expirada.', ephemeral: true });

      if (chosenIdx === qItem.answer) {
        const p = getUserProfile(interaction.user.id);
        p.xp += 50;
        p.quizWins = (p.quizWins || 0) + 1;
        if (p.xp >= p.level * 100) p.level += 1;
        saveCommunity(community);

        const winEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('✅ RESPOSTA CORRETA! (+50 XP)')
          .setDescription(`### ${qItem.q}\n\n🏆 ${interaction.user} acertou na mosca: **${qItem.options[qItem.answer]}**!\nGanhou **+50 XP** (Total: \`${p.xp} XP\` • Nível **${p.level}** • **${p.quizWins}** vitórias no Quiz)!`)
          .setTimestamp();

        const nextRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('quick_quiz_btn').setLabel('Próxima Pergunta (+50 XP)').setEmoji('🧠').setStyle(ButtonStyle.Success)
        );
        return interaction.update({ embeds: [winEmbed], components: [nextRow] });
      } else {
        return interaction.reply({
          content: `❌ Ops, **${qItem.options[chosenIdx]}** não é a resposta certa! Tente outra alternativa!`,
          ephemeral: true
        });
      }
    }

    if (interaction.customId === 'quick_rank_btn') {
      const p = getUserProfile(interaction.user.id);
      const allUsers = Object.entries(community.users)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (b.level * 1000 + b.xp) - (a.level * 1000 + a.xp));

      const top10 = allUsers.slice(0, 10).map((u, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${idx + 1}**`;
        const riotBadge = u.riotId ? ` • 🎮 \`${u.riotId}\`` : '';
        return `${medal} <@${u.id}> — **Nível ${u.level}** (\`${u.xp} XP\`) • ❤️ **${u.ggHonors || 0} GG**${riotBadge}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(`🏆 Perfil & Ranking da Comunidade — ${interaction.guild.name}`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: '⭐ Seu Nível & XP', value: `**Nível ${p.level}** (\`${p.xp}/${p.level * 100} XP\`)`, inline: true },
          { name: '🎖️ Honras Recebidas (GG)', value: `❤️ **${p.ggHonors || 0} Honras**`, inline: true },
          { name: '🎮 Conta LoL Vinculada', value: p.riotId ? `\`${p.riotId}\` (${(p.region || 'br').toUpperCase()})` : '*Use `/vincular-lol`*', inline: true },
          {
            name: '👑 TOP 10 INVOCADORES MAIS ATIVOS DO SERVIDOR',
            value: top10.length > 0 ? top10.join('\n') : 'Ninguém pontuou ainda! Mande mensagens ou jogue o Quiz!',
            inline: false
          }
        )
        .setFooter({ text: 'Use /vincular-lol para salvar seu Nick#TAG e /honrar para dar GG aos amigos!' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // F) Botões de Controle de Sala Temporária (Trancar, Destrancar, Limite 2/5/Livre)
    if (interaction.customId.startsWith('tempvc_')) {
      const parts = interaction.customId.split('_');
      const action = parts[1];
      const vcId = parts[2];
      const vc = interaction.guild.channels.cache.get(vcId) || interaction.member?.voice?.channel;

      if (!vc || !isTempVoiceChannel(vc)) {
        return interaction.reply({ content: '❌ Esta sala de voz temporária não existe mais.', ephemeral: true });
      }

      const meta = tempVoiceChannels.get(vc.id);
      const isOwnerOrAdmin =
        (meta && meta.ownerId === interaction.user.id) ||
        interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
        vc.permissionsFor(interaction.member)?.has(PermissionFlagsBits.ManageChannels);

      if (!isOwnerOrAdmin) {
        return interaction.reply({ content: '❌ Apenas o **Dono da Sala Temporária** (ou um Admin) pode usar estes controles!', ephemeral: true });
      }

      try {
        if (action === 'lock') {
          await vc.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
          return interaction.reply({ content: `🔒 Sala **${vc.name}** trancada! Ninguém de fora pode entrar agora.` });
        }
        if (action === 'unlock') {
          await vc.permissionOverwrites.edit(interaction.guild.id, { Connect: null });
          return interaction.reply({ content: `🔓 Sala **${vc.name}** destrancada! Aberta para todos os membros.` });
        }
        if (action === 'limit2') {
          await vc.setUserLimit(2);
          return interaction.reply({ content: `⚔️ Limite da sala alterado para **2 jogadores (Solo/Duo)**!` });
        }
        if (action === 'limit5') {
          await vc.setUserLimit(5);
          return interaction.reply({ content: `🏆 Limite da sala alterado para **5 jogadores (Time Clash/Flex)**!` });
        }
        if (action === 'limit0') {
          await vc.setUserLimit(0);
          return interaction.reply({ content: `♾️ Limite de jogadores removido (**Sala Livre**)!` });
        }
      } catch (err) {
        return interaction.reply({ content: `❌ Erro ao atualizar a sala: ${err.message}`, ephemeral: true });
      }
    }

    return;
  }

  // 2. COMANDOS SLASH
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // --- COMANDOS DE LEAGUE OF LEGENDS ---
  if (commandName === 'montar-clash') {
    const title = interaction.options.getString('titulo');
    const tier = interaction.options.getString('tier');
    const time = interaction.options.getString('horario');

    const teamData = {
      creatorId: interaction.user.id,
      title,
      tier,
      time,
      roles: { top: null, jg: null, mid: null, adc: null, sup: null }
    };

    const clashRole = interaction.guild.roles.cache.find(r => r.name.includes('Jogo Clash'));
    const mentionText = clashRole ? `🔔 ${clashRole} — Nova escalação aberta por ${interaction.user}!` : `🔔 Nova escalação aberta por ${interaction.user}!`;

    const msg = await interaction.reply({
      content: mentionText,
      embeds: [buildClashEmbed(teamData)],
      components: buildClashButtons(),
      fetchReply: true
    });

    clashTeams.set(msg.id, teamData);
    return;
  }

  if (commandName === 'procurar-duo') {
    const modo = interaction.options.getString('modo');
    const lane = interaction.options.getString('sua-lane');
    const elo = interaction.options.getString('elo');
    const riotId = interaction.options.getString('riotid');
    const obs = interaction.options.getString('observacao') || 'Bora jogar! Me chama na DM ou entra na call!';

    const formattedRiotId = encodeURIComponent(riotId.replace('#', '-'));
    const opggUrl = `https://www.op.gg/summoners/br/${formattedRiotId}`;

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setAuthor({ name: `${interaction.user.tag} está procurando time/duo!`, iconURL: interaction.user.displayAvatarURL() })
      .setTitle(`🎮 Procurando Partida — ${modo}`)
      .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '🆔 Riot ID (Nick#TAG)', value: `\`${riotId}\` ([Ver OP.GG](${opggUrl}))`, inline: true },
        { name: '⚔️ Rota Principal', value: `**${lane}**`, inline: true },
        { name: '🏅 Elo Atual', value: `**${elo}**`, inline: true },
        { name: '💬 Observações', value: obs, inline: false }
      )
      .setFooter({ text: 'Mande mensagem para o jogador ou entre em uma das salas de voz de LoL!' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'perfil-lol') {
    await interaction.deferReply();
    const userProf = getUserProfile(interaction.user.id);
    const rawRiotId = (interaction.options.getString('nick-tag') || userProf.riotId || '').trim();
    if (!rawRiotId) {
      return interaction.editReply({
        content: 'ℹ️ Digite um **Nick#TAG** (Ex: `/perfil-lol nick-tag:Faker#BR1`) ou salve sua conta uma única vez usando **`/vincular-lol`**!'
      });
    }
    const region = interaction.options.getString('regiao') || userProf.region || 'br';

    const parts = rawRiotId.split('#');
    const gameName = parts[0].trim();
    const tagLine = (parts[1] || (region === 'br' ? 'BR1' : region.toUpperCase())).trim();

    const opggSlug = `${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
    const opggUrl = `https://www.op.gg/summoners/${region}/${opggSlug}?hl=pt_BR`;
    const porofessorUrl = `https://porofessor.gg/pt/live/${region}/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;

    try {
      const res = await fetch(opggUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();
      const tokens = html
        .replace(/<script[\s\S]*?<\/script>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '\n')
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map(s => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim())
        .filter(Boolean);

      const iconMatch = html.match(/https:\/\/opgg-static\.akamaized\.net\/meta\/images\/profile_icons\/profileIcon[0-9]+\.jpg[^"']*/i);
      const profileIcon = iconMatch ? iconMatch[0] : interaction.user.displayAvatarURL();

      let level = 'N/A';
      const nameIdx = tokens.findIndex((t, idx) => t.toLowerCase() === gameName.toLowerCase() && tokens[idx + 1] === '#');
      if (nameIdx > 0) level = tokens[nameIdx - 1];

      let soloRank = 'Sem classificação (Unranked)';
      let soloRecord = 'Sem jogos ranqueados';
      const featIdx = tokens.indexOf('Em destaque');
      if (featIdx !== -1) {
        const soloIdx = tokens.indexOf('Ranqueada Solo/Duo', featIdx);
        if (soloIdx !== -1) {
          const tier = tokens[soloIdx + 1] || 'Sem classificação';
          if (tier !== 'Sem classificação') {
            const lp = tokens[soloIdx + 2] || '0';
            const wins = tokens[soloIdx + 4] || '0';
            const losses = tokens[soloIdx + 6] || '0';
            const wr = tokens[soloIdx + 9] || '0';
            soloRank = `🏆 **${tier}** (${lp} PDL)`;
            soloRecord = `⚔️ **${wins}V ${losses}D** (**${wr}%** Winrate)`;
          }
        }
      }

      let flexRank = 'Sem classificação (Unranked)';
      const seasonsEndIdx = tokens.indexOf('Visualizar todas as categorias da temporada');
      if (seasonsEndIdx !== -1) {
        const fIdx = tokens.indexOf('Ranqueada Flex', seasonsEndIdx);
        if (fIdx !== -1 && tokens[fIdx + 1] && tokens[fIdx + 1] !== 'Sem classificação') {
          flexRank = `🛡️ **${tokens[fIdx + 1]}** (${tokens[fIdx + 2] || '0'} PDL)`;
        }
      }

      const masteries = [];
      const mastIdx = tokens.lastIndexOf('Maestria');
      if (mastIdx !== -1) {
        let i = mastIdx + 1;
        while (i < Math.min(mastIdx + 30, tokens.length) && masteries.length < 4) {
          if (tokens[i + 2] === 'pts' && !isNaN(Number(tokens[i - 1]))) {
            masteries.push(`• **${tokens[i]}** — Nível ${tokens[i - 1]} (\`${tokens[i + 1]} pts\`)`);
            i += 3;
          } else if (tokens[i + 2] === 'pts') {
            masteries.push(`• **${tokens[i]}** — \`${tokens[i + 1]} pts\``);
            i += 3;
          } else {
            i++;
          }
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`🔎 Perfil de Invocador: ${gameName}#${tagLine}`)
        .setURL(opggUrl)
        .setThumbnail(profileIcon)
        .addFields(
          { name: '⭐ Nível da Conta', value: `**Nível ${level}** (${region.toUpperCase()})`, inline: true },
          { name: '⚔️ Ranqueada Solo/Duo', value: `${soloRank}\n${soloRecord}`, inline: true },
          { name: '🛡️ Ranqueada Flex', value: flexRank, inline: true },
          {
            name: '👑 Principais Campeões (Maestrias)',
            value: masteries.length > 0 ? masteries.join('\n') : '*Nenhum dado de maestria encontrado*',
            inline: false
          }
        )
        .setFooter({ text: `Dados reais extraídos em tempo real • Consultado por ${interaction.user.tag}` })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Ver Histórico Completo (OP.GG)').setStyle(ButtonStyle.Link).setURL(opggUrl).setEmoji('📊'),
        new ButtonBuilder().setLabel('Partida Ao Vivo (Porofessor)').setStyle(ButtonStyle.Link).setURL(porofessorUrl).setEmoji('🔴')
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Não foi possível carregar os dados de **${gameName}#${tagLine}**. Verifique se o Riot ID está correto!` });
    }
  }

  if (commandName === 'build') {
    await interaction.deferReply();
    const rawChamp = interaction.options.getString('campeao').trim();
    const lane = interaction.options.getString('lane') || '';
    const cleanSlug = rawChamp.toLowerCase().replace(/[^a-z0-9]/g, '');
    const opggBuildUrl = `https://www.op.gg/champions/${cleanSlug}/build${lane ? `/${lane}` : ''}?hl=pt_BR`;

    try {
      const res = await fetch(opggBuildUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();
      const withAlts = html.replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, '\n[IMG:$1]\n');
      const tokens = withAlts
        .replace(/<script[\s\S]*?<\/script>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '\n')
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map(s => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim())
        .filter(Boolean);

      const champImgMatch = html.match(/https:\/\/opgg-static\.akamaized\.net\/meta\/images\/lol\/[^"']+\/champion\/[^"']+\.png[^"']*/i);
      const thumbnail = champImgMatch ? champImgMatch[0] : null;

      const wrIdx = tokens.indexOf('Taxa de vitória');
      const winRate = wrIdx !== -1 ? tokens[wrIdx + 1] : 'N/A';
      const prIdx = tokens.indexOf('Taxa de escolha');
      const pickRate = prIdx !== -1 ? tokens[prIdx + 1] : 'N/A';
      const brIdx = tokens.indexOf('Taxa de banimento');
      const banRate = brIdx !== -1 ? tokens[brIdx + 1] : 'N/A';

      // Runas ativas
      const runes = [];
      const runasStart = tokens.indexOf('runas');
      const spellsStart = tokens.indexOf('Feitiços de Invocador');
      if (runasStart !== -1 && spellsStart !== -1) {
        let firstTreeEnd = tokens.indexOf('Fragmentos', runasStart);
        if (firstTreeEnd === -1 || firstTreeEnd > spellsStart) firstTreeEnd = spellsStart;
        for (let i = runasStart; i < firstTreeEnd; i++) {
          if (tokens[i].startsWith('[IMG:')) {
            const rName = tokens[i].slice(5, -1);
            const next1 = tokens[i + 1] || '';
            const next2 = tokens[i + 2] || '';
            if (next1.endsWith('%') && next2.endsWith('%')) {
              const pickPct = parseFloat(next2);
              if (pickPct >= 18 && !runes.includes(rName)) {
                runes.push(rName);
              }
            }
          }
        }
      }

      // Feitiços de Invocador
      const spells = [];
      if (spellsStart !== -1) {
        for (let i = spellsStart; i < Math.min(spellsStart + 25, tokens.length); i++) {
          if (tokens[i].startsWith('[IMG:')) {
            spells.push(tokens[i].slice(5, -1));
            if (spells.length === 2) break;
          }
        }
      }

      // Ordem de Habilidades
      const skillOrder = [];
      const skillIdx = tokens.indexOf('SkillOrder Table');
      if (skillIdx !== -1) {
        for (let i = skillIdx; i < Math.min(skillIdx + 20, tokens.length); i++) {
          if (['Q', 'W', 'E'].includes(tokens[i]) && !skillOrder.includes(tokens[i])) {
            skillOrder.push(tokens[i]);
            if (skillOrder.length === 3) break;
          }
        }
      }

      // Itens Iniciais
      const starterItems = [];
      const startIdx = tokens.indexOf('Itens iniciais');
      if (startIdx !== -1) {
        for (let i = startIdx + 1; i < Math.min(startIdx + 12, tokens.length); i++) {
          if (tokens[i].startsWith('[IMG:')) {
            starterItems.push(tokens[i].slice(5, -1));
          } else if (tokens[i].endsWith('%')) {
            break;
          }
        }
      }

      // Botas
      let boots = 'N/A';
      const bootsIdx = tokens.indexOf('Boots Table');
      if (bootsIdx !== -1) {
        for (let i = bootsIdx; i < Math.min(bootsIdx + 10, tokens.length); i++) {
          if (tokens[i].startsWith('[IMG:')) {
            boots = `**${tokens[i].slice(5, -1)}** (${tokens[i + 1] || ''})`;
            break;
          }
        }
      }

      // Builds Principais (Top 3 combinações de itens)
      const coreBuilds = [];
      const buildsIdx = tokens.indexOf('Builds principais');
      const fourthIdx = tokens.indexOf('Quarto item');
      if (buildsIdx !== -1) {
        let i = buildsIdx + 1;
        const limit = fourthIdx !== -1 ? fourthIdx : buildsIdx + 40;
        let currentCombo = [];
        while (i < limit && coreBuilds.length < 3) {
          if (tokens[i].startsWith('[IMG:')) {
            currentCombo.push(tokens[i].slice(5, -1));
          } else if (tokens[i].endsWith('%') && currentCombo.length >= 2) {
            const pick = tokens[i];
            const wr = tokens[i + 3] || '';
            coreBuilds.push(`• **${currentCombo.join(' ➔ ')}** (\`${wr} WR\` • ${pick} escolha)`);
            currentCombo = [];
            i += 3;
          }
          i++;
        }
      }

      // Opções de 4º/5º item
      const lateItems = [];
      if (fourthIdx !== -1) {
        for (let i = fourthIdx; i < Math.min(fourthIdx + 25, tokens.length); i++) {
          if (tokens[i].startsWith('[IMG:')) {
            const item = tokens[i].slice(5, -1);
            if (!lateItems.includes(item)) lateItems.push(item);
            if (lateItems.length >= 4) break;
          }
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`⚔️ Build & Runas no Patch Atual: ${rawChamp.toUpperCase()} ${lane ? `(${lane.toUpperCase()})` : ''}`)
        .setURL(opggBuildUrl)
        .setDescription(`📊 **Win Rate:** \`${winRate}\` • **Pick Rate:** \`${pickRate}\` • **Ban Rate:** \`${banRate}\``)
        .addFields(
          {
            name: '💎 Árvore de Runas Recomendada',
            value: runes.length > 0
              ? `🔥 **Runa Essencial:** **${runes[0]}**\n✨ **Secundárias:** ${runes.slice(1).join(' • ')}`
              : 'Consulte no link abaixo',
            inline: false
          },
          {
            name: '🔥 Feitiços',
            value: spells.length > 0 ? `**${spells.join(' + ')}**` : 'Flash + Incendiar/TP',
            inline: true
          },
          {
            name: '🎯 Ordem de Skills',
            value: skillOrder.length > 0 ? `**${skillOrder.join(' ➔ ')}** (Max ${skillOrder[0]})` : 'Q ➔ E ➔ W',
            inline: true
          },
          {
            name: '👟 Botas Principais',
            value: boots,
            inline: true
          },
          {
            name: '🛡️ Itens Iniciais',
            value: starterItems.length > 0 ? starterItems.join(' + ') : 'Item de Doran + Poção',
            inline: false
          },
          {
            name: '⚔️ Core Build (3 Primeiros Itens)',
            value: coreBuilds.length > 0 ? coreBuilds.join('\n') : 'Não encontrado',
            inline: false
          },
          {
            name: '🌟 Opções de 4º e 5º Item (Late Game)',
            value: lateItems.length > 0 ? lateItems.map(x => `\`${x}\``).join(' • ') : 'Situacional',
            inline: false
          }
        )
        .setFooter({ text: `Dados reais extraídos em tempo real • Consultado por ${interaction.user.tag}` })
        .setTimestamp();

      if (thumbnail) embed.setThumbnail(thumbnail);

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Não consegui encontrar o campeão **${rawChamp}**. Verifique a grafia (Ex: \`Yasuo\`, \`Lee Sin\`, \`Kaisa\`).` });
    }
  }

  if (commandName === 'counter') {
    await interaction.deferReply();
    const rawChamp = interaction.options.getString('campeao').trim();
    const lane = interaction.options.getString('lane') || '';
    const cleanSlug = rawChamp.toLowerCase().replace(/[^a-z0-9]/g, '');
    const url = `https://www.op.gg/champions/${cleanSlug}/build${lane ? `/${lane}` : ''}?hl=pt_BR`;

    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();
      const withAlts = html.replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, '\n[IMG:$1]\n');
      const tokens = withAlts
        .replace(/<script[\s\S]*?<\/script>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '\n')
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map(s => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim())
        .filter(Boolean);

      const champImgMatch = html.match(/https:\/\/opgg-static\.akamaized\.net\/meta\/images\/lol\/[^"']+\/champion\/[^"']+\.png[^"']*/i);
      const thumbnail = champImgMatch ? champImgMatch[0] : null;

      const wrIdx = tokens.indexOf('Taxa de vitória');
      const winRate = wrIdx !== -1 ? tokens[wrIdx + 1] : 'N/A';
      const prIdx = tokens.indexOf('Taxa de escolha');
      const pickRate = prIdx !== -1 ? tokens[prIdx + 1] : 'N/A';
      const brIdx = tokens.indexOf('Taxa de banimento');
      const banRate = brIdx !== -1 ? tokens[brIdx + 1] : 'N/A';

      const tips = [];
      const betaIdx = tokens.indexOf('Resumo dos comentários dos usuários');
      if (betaIdx !== -1) {
        for (let i = betaIdx + 2; i < Math.min(betaIdx + 8, tokens.length); i++) {
          if (tokens[i] === 'Taxa de vitória' || tokens[i] === 'Build') break;
          if (tokens[i].length > 20) tips.push(`💡 ${tokens[i]}`);
        }
      }

      // Fraco contra (Melhores Counters para pickar contra ele)
      const weakAgainst = [];
      const weakIdx = tokens.indexOf('Fraco contra');
      if (weakIdx !== -1) {
        let i = weakIdx + 1;
        while (i < tokens.length && tokens[i] !== 'Forte contra' && weakAgainst.length < 5) {
          if (tokens[i].startsWith('[IMG:')) {
            const name = tokens[i].slice(5, -1);
            const champWr = tokens[i + 1] || '';
            const enemyWr = champWr.endsWith('%') ? `${(100 - parseFloat(champWr)).toFixed(2)}%` : '';
            const games = tokens[i + 2] || '';
            weakAgainst.push(`🛡️ **${name}** — Ganha **${enemyWr}** das vezes contra ${rawChamp} (\`${games} jogos\`)`);
            i += 4;
          } else {
            i++;
          }
        }
      }

      // Forte contra (Quem APANHA para ele - Evite pickar!)
      const strongAgainst = [];
      const strongIdx = tokens.indexOf('Forte contra');
      if (strongIdx !== -1) {
        let i = strongIdx + 1;
        while (i < tokens.length && strongAgainst.length < 5) {
          if (tokens[i].startsWith('[IMG:')) {
            const name = tokens[i].slice(5, -1);
            const champWr = tokens[i + 1] || '';
            const games = tokens[i + 2] || '';
            strongAgainst.push(`⚠️ **${name}** — ${rawChamp} vence **${champWr}** das vezes (\`${games} jogos\`)`);
            i += 4;
          } else if (tokens[i] === 'Sinergias' || tokens[i] === 'Ranking de maestria') {
            break;
          } else {
            i++;
          }
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`🛡️ Counters & Matchups: Como ganhar de ${rawChamp.toUpperCase()} ${lane ? `(${lane.toUpperCase()})` : ''}`)
        .setURL(url)
        .setDescription(`📊 **Win Rate de ${rawChamp}:** \`${winRate}\` • **Pick Rate:** \`${pickRate}\` • **Ban Rate:** \`${banRate}\``)
        .addFields(
          {
            name: `🔥 MELHORES COUNTERS (Pegue estes para ganhar de ${rawChamp}):`,
            value: weakAgainst.length > 0 ? weakAgainst.join('\n') : 'Dados insuficientes nesta rota',
            inline: false
          },
          {
            name: `💀 PIORES ESCOLHAS (Evite pegar contra ${rawChamp}):`,
            value: strongAgainst.length > 0 ? strongAgainst.join('\n') : 'Dados insuficientes nesta rota',
            inline: false
          }
        )
        .setFooter({ text: `Dados reais extraídos em tempo real • Consultado por ${interaction.user.tag}` })
        .setTimestamp();

      if (tips.length > 0) {
        embed.addFields({
          name: `🧠 Dicas de Como Jogar Contra / Com ${rawChamp}:`,
          value: tips.join('\n'),
          inline: false
        });
      }

      if (thumbnail) embed.setThumbnail(thumbnail);

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Não consegui buscar os counters de **${rawChamp}**. Verifique o nome do campeão!` });
    }
  }

  if (commandName === 'tierlist') {
    await interaction.deferReply();
    const lane = interaction.options.getString('lane') || 'mid';
    const posMap = { top: 'top', jungle: 'jungle', mid: 'mid', adc: 'adc', support: 'support' };
    const pos = posMap[lane] || 'mid';
    const url = `https://www.op.gg/champions?hl=pt_BR&position=${pos}`;

    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();
      const tokens = html
        .replace(/<script[\s\S]*?<\/script>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '\n')
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map(s => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim())
        .filter(Boolean);

      const startIdx = tokens.indexOf('Oposição');
      const champs = [];
      if (startIdx !== -1) {
        let i = startIdx + 1;
        while (i < tokens.length - 4 && champs.length < 10) {
          if (
            !tokens[i].endsWith('%') &&
            isNaN(Number(tokens[i])) &&
            tokens[i + 1]?.endsWith('%') &&
            tokens[i + 2]?.endsWith('%') &&
            tokens[i + 3]?.endsWith('%')
          ) {
            champs.push({
              rank: champs.length + 1,
              name: tokens[i],
              wr: tokens[i + 1],
              pr: tokens[i + 2],
              br: tokens[i + 3]
            });
            i += 4;
          } else {
            i++;
          }
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(`🏆 TOP 10 CAMPEÕES DO META (TIER S+) — ROTA: ${lane.toUpperCase()}`)
        .setURL(url)
        .setDescription(
          champs.length > 0
            ? champs.map(c => `**#${c.rank} ${c.name}** — 🏆 \`${c.wr} WR\` • 🎯 \`${c.pr} Pick\` • 🚫 \`${c.br} Ban\``).join('\n')
            : 'Não foi possível carregar a lista no momento.'
        )
        .setFooter({ text: `Tier List em tempo real (Esmeralda+) • Consultado por ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: '❌ Erro ao buscar a Tier List em tempo real.' });
    }
  }

  if (commandName === 'rank-campeao') {
    await interaction.deferReply();
    const rawChamp = interaction.options.getString('campeao').trim();
    const searchNick = interaction.options.getString('nick-tag')?.trim() || '';
    const cleanSlug = rawChamp.toLowerCase().replace(/[^a-z0-9]/g, '');

    async function fetchRegionLeaderboard(region, page = 1) {
      const url = `https://www.op.gg/leaderboards/champions/${cleanSlug}?region=${region}&page=${page}&hl=pt_BR`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();
      const tokens = html
        .replace(/<script[\s\S]*?<\/script>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '\n')
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map(s => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim())
        .filter(Boolean);

      const champImgMatch = html.match(/https:\/\/opgg-static\.akamaized\.net\/meta\/images\/lol\/[^"']+\/champion\/[^"']+\.png[^"']*/i);
      const thumbnail = champImgMatch ? champImgMatch[0] : null;

      const idx = tokens.indexOf('Champion Table');
      const players = [];
      if (idx !== -1) {
        let i = idx + 8;
        while (i < tokens.length - 10 && players.length < 50) {
          if (!isNaN(Number(tokens[i])) && tokens[i + 2] === '#') {
            const rank = Number(tokens[i]);
            const name = tokens[i + 1];
            const tag = tokens[i + 3];
            const tier = tokens[i + 4];
            const lp = tokens[i + 6];
            const kda = tokens[i + 7];
            const gamesStr = tokens[i + 8];
            const wins = tokens[i + 9];
            const losses = tokens[i + 11];
            const wr = tokens[i + 13];
            players.push({
              rank,
              region: region.toUpperCase(),
              riotId: `${name}#${tag}`,
              nameLower: name.toLowerCase(),
              tagLower: tag.toLowerCase(),
              tier,
              lp,
              kda,
              games: Number(String(gamesStr).replace(/,/g, '')) || 0,
              gamesStr,
              wins,
              losses,
              wr
            });
            i += 14;
          } else {
            i++;
          }
        }
      }
      return { thumbnail, players };
    }

    try {
      // Busca em paralelo: Top 100 BR (páginas 1 e 2) + Top 50 KR, EUW e NA para montar o Ranking Mundial!
      const [brPage1, brPage2, krPage1, euwPage1, naPage1] = await Promise.all([
        fetchRegionLeaderboard('br', 1),
        fetchRegionLeaderboard('br', 2),
        fetchRegionLeaderboard('kr', 1),
        fetchRegionLeaderboard('euw', 1),
        fetchRegionLeaderboard('na', 1)
      ]);

      const brAll = [...brPage1.players, ...brPage2.players];
      const worldPool = [...brPage1.players, ...krPage1.players, ...euwPage1.players, ...naPage1.players];
      worldPool.sort((a, b) => b.games - a.games);

      const flagMap = { BR: '🇧🇷', KR: '🇰🇷', EUW: '🇪🇺', NA: '🇺🇸' };

      const top10BR = brAll.slice(0, 10).map((p, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${p.rank}**`;
        return `${medal} **${p.riotId}** — ${p.tier} (${p.lp} PDL) • **${p.gamesStr} jogos** (\`${p.wr} WR\` | \`${p.kda} KDA\`)`;
      });

      const top10World = worldPool.slice(0, 10).map((p, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${idx + 1}**`;
        return `${medal} ${flagMap[p.region] || '🌐'} **${p.riotId}** — ${p.tier} • **${p.gamesStr} jogos** (\`${p.wr} WR\` | \`${p.kda} KDA\`)`;
      });

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(`👑 RANKING DE MONO CHAMPIONS: ${rawChamp.toUpperCase()} (BRASIL & MUNDO)`)
        .setURL(`https://www.op.gg/leaderboards/champions/${cleanSlug}?region=br&hl=pt_BR`)
        .setDescription(`Ranking em tempo real dos jogadores **High Elo (Diamante II ao Desafiante)** com mais partidas e melhor desempenho de **${rawChamp.toUpperCase()}** na temporada!`)
        .addFields(
          {
            name: `🇧🇷 TOP 10 BRASIL — ${rawChamp.toUpperCase()}`,
            value: top10BR.length > 0 ? top10BR.join('\n') : 'Nenhum dado encontrado para este campeão.',
            inline: false
          },
          {
            name: `🌎 TOP 10 MUNDO (BR / KR / EUW / NA) — ${rawChamp.toUpperCase()}`,
            value: top10World.length > 0 ? top10World.join('\n') : 'Nenhum dado encontrado.',
            inline: false
          }
        )
        .setFooter({ text: `Dados reais extraídos em tempo real • Consultado por ${interaction.user.tag}` })
        .setTimestamp();

      if (brPage1.thumbnail) embed.setThumbnail(brPage1.thumbnail);

      // Se o usuário digitou um Nick#TAG para checar se é Top 30 / Top 100 BR ou Mundo:
      if (searchNick) {
        const parts = searchNick.toLowerCase().split('#');
        const targetName = parts[0].trim();
        const targetTag = parts[1]?.trim() || '';

        const foundBR = brAll.find(p =>
          targetTag ? (p.nameLower === targetName && p.tagLower === targetTag) : p.nameLower.includes(targetName)
        );
        const foundWorldIdx = worldPool.findIndex(p =>
          targetTag ? (p.nameLower === targetName && p.tagLower === targetTag) : p.nameLower.includes(targetName)
        );

        let statusText = '';
        if (foundBR) {
          const badgeBR = foundBR.rank <= 10 ? '🔥 **TOP 10 DO BRASIL!**' : foundBR.rank <= 30 ? '⭐ **TOP 30 DO BRASIL!**' : '✅ **TOP 100 DO BRASIL!**';
          statusText += `🇧🇷 **Posição no Brasil:** **#${foundBR.rank} BR** (${badgeBR})\n📊 **Estatísticas:** ${foundBR.tier} (${foundBR.lp} PDL) • **${foundBR.gamesStr} jogos** (${foundBR.wins}V ${foundBR.losses}D • \`${foundBR.wr} WR\` • \`${foundBR.kda} KDA\`)\n`;
        } else {
          statusText += `🇧🇷 **Brasil:** **${searchNick}** ainda não aparece no Top 100 BR de **${rawChamp}** (Requisito: Diamante II+ e ~400+ jogos na season).\n`;
        }

        if (foundWorldIdx !== -1) {
          const wRank = foundWorldIdx + 1;
          const wPlayer = worldPool[foundWorldIdx];
          statusText += `🌎 **Posição Mundial:** **#${wRank} DO MUNDO** (${flagMap[wPlayer.region] || ''} ${wPlayer.riotId} com **${wPlayer.gamesStr} jogos**)!`;
        }

        embed.addFields({
          name: `🔎 Consulta de Ranking Individual: ${searchNick}`,
          value: statusText,
          inline: false
        });
      } else {
        embed.addFields({
          name: '💡 Quer saber se você ou alguém está no Top 30 / Top 100?',
          value: `Use **\`/rank-campeao campeao:${rawChamp} nick-tag:Nome#TAG\`** (Ex: \`Zadx#Zed\`) para verificar a posição exata no Brasil e no Mundo!`,
          inline: false
        });
      }

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Erro ao consultar o ranking de **${rawChamp}**. Verifique o nome do campeão!` });
    }
  }

  if (commandName === 'meu-campeao') {
    await interaction.deferReply();
    const userProf = getUserProfile(interaction.user.id);
    const rawRiotId = (interaction.options.getString('nick-tag') || userProf.riotId || '').trim();
    if (!rawRiotId) {
      return interaction.editReply({
        content: 'ℹ️ Digite seu **Nick#TAG** (Ex: `/meu-campeao campeao:Zed nick-tag:MeuNick#BR1`) ou salve sua conta uma única vez com **`/vincular-lol`**!'
      });
    }
    const rawChamp = interaction.options.getString('campeao').trim();
    const region = interaction.options.getString('regiao') || userProf.region || 'br';

    const parts = rawRiotId.split('#');
    const gameName = parts[0].trim();
    const tagLine = (parts[1] || (region === 'br' ? 'BR1' : region.toUpperCase())).trim();

    const opggSlug = `${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
    const cleanChampSlug = rawChamp.toLowerCase().replace(/[^a-z0-9]/g, '');

    function toPlainTokens(html) {
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '\n')
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map(s => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim())
        .filter(Boolean);
    }

    async function fetchLeaderboardPage(reg, page) {
      try {
        const u = `https://www.op.gg/leaderboards/champions/${cleanChampSlug}?region=${reg}&page=${page}&hl=pt_BR`;
        const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const h = await r.text();
        const t = toPlainTokens(h);
        const champImgMatch = h.match(/https:\/\/opgg-static\.akamaized\.net\/meta\/images\/lol\/[^"']+\/champion\/[^"']+\.png[^"']*/i);
        const thumbnail = champImgMatch ? champImgMatch[0] : null;
        const idx = t.indexOf('Champion Table');
        const players = [];
        if (idx !== -1) {
          let i = idx + 8;
          while (i < t.length - 10 && players.length < 50) {
            if (!isNaN(Number(t[i])) && t[i + 2] === '#') {
              players.push({
                rank: Number(t[i]),
                region: reg.toUpperCase(),
                nameLower: t[i + 1].toLowerCase(),
                tagLower: t[i + 3].toLowerCase(),
                tier: t[i + 4],
                lp: t[i + 6],
                games: Number(String(t[i + 8]).replace(/,/g, '')) || 0
              });
              i += 14;
            } else {
              i++;
            }
          }
        }
        return { thumbnail, players };
      } catch (e) {
        return { thumbnail: null, players: [] };
      }
    }

    try {
      const champsUrl = `https://www.op.gg/summoners/${region}/${opggSlug}/champions?hl=pt_BR`;
      const masteryUrl = `https://www.op.gg/summoners/${region}/${opggSlug}/mastery?hl=pt_BR`;

      // Busca simultaneamente: Campeões da Season + Maestrias + Top 100 da Região + Top Global
      const [champsRes, masteryRes, regP1, regP2, krP1, euwP1] = await Promise.all([
        fetch(champsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
        fetch(masteryUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
        fetchLeaderboardPage(region, 1),
        fetchLeaderboardPage(region, 2),
        fetchLeaderboardPage('kr', 1),
        fetchLeaderboardPage('euw', 1)
      ]);

      const champsHtml = await champsRes.text();
      const masteryHtml = await masteryRes.text();
      const champsTokens = toPlainTokens(champsHtml);
      const masteryTokens = toPlainTokens(masteryHtml);

      // 1. Extrair Maestria com o campeão
      let masteryLevel = 'N/A';
      let masteryPoints = '0';
      const mastStart = masteryTokens.indexOf('Maestria de campeões');
      if (mastStart !== -1) {
        for (let i = mastStart; i < masteryTokens.length - 2; i++) {
          const tClean = masteryTokens[i].toLowerCase().replace(/[^a-z0-9]/g, '');
          if (tClean === cleanChampSlug) {
            masteryLevel = !isNaN(Number(masteryTokens[i - 1])) ? masteryTokens[i - 1] : '1+';
            masteryPoints = masteryTokens[i + 1] || '0';
            break;
          }
        }
      }

      // 2. Extrair Estatísticas Ranqueadas na Temporada com o campeão
      let wins = '0', losses = '0', winrate = '0%', kdaRatio = 'N/A', kdaDetail = 'N/A';
      let csInfo = 'N/A', goldInfo = 'N/A', doubles = '0', triples = '0', quadras = '0', pentas = '0';
      let foundSeasonStats = false;

      const tableStart = champsTokens.indexOf('Todos os campeões');
      if (tableStart !== -1) {
        for (let i = tableStart + 15; i < champsTokens.length - 15; i++) {
          const tClean = champsTokens[i].toLowerCase().replace(/[^a-z0-9]/g, '');
          if (tClean === cleanChampSlug && champsTokens[i - 1] !== 'vs') {
            // Verifica se tem W e L ou apenas W ou L
            let offset = i + 1;
            if (champsTokens[offset + 1] === 'W' && champsTokens[offset + 3] === 'L') {
              wins = champsTokens[offset];
              losses = champsTokens[offset + 2];
              offset += 4;
            } else if (champsTokens[offset + 1] === 'W') {
              wins = champsTokens[offset];
              losses = '0';
              offset += 2;
            } else if (champsTokens[offset + 1] === 'L') {
              wins = '0';
              losses = champsTokens[offset];
              offset += 2;
            }
            winrate = champsTokens[offset] || '0%';
            kdaRatio = champsTokens[offset + 1] || 'N/A';
            kdaDetail = champsTokens[offset + 2] || 'N/A';
            csInfo = `${champsTokens[offset + 11] || '0'} (${champsTokens[offset + 12] || '0/m'})`;
            goldInfo = `${champsTokens[offset + 13] || '0'} (${champsTokens[offset + 14] || '0/m'})`;
            doubles = champsTokens[offset + 15] || '0';
            triples = champsTokens[offset + 16] || '0';
            quadras = champsTokens[offset + 17] || '0';
            pentas = champsTokens[offset + 18] || '0';
            foundSeasonStats = true;
            break;
          }
        }
      }

      // 3. Verificar Posição no Ranking BR e Mundial
      const regAll = [...regP1.players, ...regP2.players];
      const targetName = gameName.toLowerCase();
      const targetTag = tagLine.toLowerCase();

      const foundReg = regAll.find(p => p.nameLower === targetName && p.tagLower === targetTag);
      const worldPool = [...regP1.players, ...krP1.players, ...euwP1.players];
      worldPool.sort((a, b) => b.games - a.games);
      const foundWorldIdx = worldPool.findIndex(p => p.nameLower === targetName && p.tagLower === targetTag);

      let rankBadge = '';
      if (foundReg) {
        const topLabel = foundReg.rank <= 10 ? '🔥 **TOP 10**' : foundReg.rank <= 30 ? '⭐ **TOP 30**' : '✅ **TOP 100**';
        rankBadge += `🇧🇷 **Rank ${region.toUpperCase()}:** **#${foundReg.rank}** (${topLabel} de ${rawChamp.toUpperCase()}!)\n`;
      } else {
        const minGames = regAll.length > 0 ? regAll[regAll.length - 1].games : 400;
        rankBadge += `🇧🇷 **Rank ${region.toUpperCase()}:** Fora do Top 100 High Elo *(Corte atual do Top 100: Diamante II+ e ~${minGames} jogos)*\n`;
      }

      if (foundWorldIdx !== -1) {
        rankBadge += `🌎 **Rank Mundial:** **#${foundWorldIdx + 1} DO MUNDO**!`;
      } else {
        rankBadge += `🌎 **Rank Mundial:** Fora do Top 100 Global`;
      }

      const totalGames = Number(wins) + Number(losses);

      const embed = new EmbedBuilder()
        .setColor(foundReg ? 0xf1c40f : 0x3498db)
        .setTitle(`⚔️ Desempenho & Rank com ${rawChamp.toUpperCase()}: ${gameName}#${tagLine}`)
        .setURL(champsUrl)
        .setDescription(rankBadge)
        .addFields(
          {
            name: '👑 Maestria de Campeão',
            value: masteryPoints !== '0'
              ? `**Nível ${masteryLevel}**\n\`${masteryPoints} pontos\``
              : '*Sem maestria registrada*',
            inline: true
          },
          {
            name: '📊 Ranqueada (Temporada Atual)',
            value: foundSeasonStats
              ? `**${totalGames} Jogos** (${wins}V ${losses}D)\nWinrate: **${winrate}**`
              : '**0 Jogos** (0V 0D)\n*Sem ranqueadas na season*',
            inline: true
          },
          {
            name: '⚔️ KDA Médio',
            value: foundSeasonStats
              ? `**${kdaRatio}**\n\`${kdaDetail}\``
              : '**0.00:1**\n`0.0 / 0.0 / 0.0`',
            inline: true
          },
          {
            name: '🌾 Farm (CS Médio)',
            value: foundSeasonStats ? `\`${csInfo}\`` : '`0.0 (0.0/m)`',
            inline: true
          },
          {
            name: '💰 Ouro Médio',
            value: foundSeasonStats ? `\`${goldInfo}\`` : '`0 (0/m)`',
            inline: true
          },
          {
            name: '🔥 Multi-Kills na Season',
            value: `Double: **${doubles}** • Triple: **${triples}** • Quadra: **${quadras}** • Penta: **${pentas}**`,
            inline: false
          }
        )
        .setFooter({ text: `Dados reais extraídos em tempo real • Consultado por ${interaction.user.tag}` })
        .setTimestamp();

      if (regP1.thumbnail) embed.setThumbnail(regP1.thumbnail);

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Erro ao buscar os dados de **${gameName}#${tagLine}** com **${rawChamp}**.` });
    }
  }

  // --- NOVOS COMANDOS DA COMUNIDADE & DIVERSÃO ---
  if (commandName === 'vincular-lol') {
    await interaction.deferReply();
    const rawRiotId = interaction.options.getString('nick-tag').trim();
    const region = interaction.options.getString('regiao') || 'br';
    const parts = rawRiotId.split('#');
    const gameName = parts[0].trim();
    const tagLine = (parts[1] || (region === 'br' ? 'BR1' : region.toUpperCase())).trim();
    const fullRiotId = `${gameName}#${tagLine}`;

    const opggSlug = `${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
    const opggUrl = `https://www.op.gg/summoners/${region}/${opggSlug}?hl=pt_BR`;

    let detectedTier = 'Sem classificação';
    let roleAssigned = 'Nenhum (Unranked)';

    try {
      const res = await fetch(opggUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();
      const tokens = html
        .replace(/<script[\s\S]*?<\/script>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '\n')
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map(s => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim())
        .filter(Boolean);

      const featIdx = tokens.indexOf('Em destaque');
      if (featIdx !== -1) {
        const soloIdx = tokens.indexOf('Ranqueada Solo/Duo', featIdx);
        if (soloIdx !== -1 && tokens[soloIdx + 1]) {
          detectedTier = tokens[soloIdx + 1];
        }
      }

      // Sincroniza automaticamente o Cargo de Elo do membro no Discord!
      const tierLower = detectedTier.toLowerCase();
      let targetRoleName = null;
      if (tierLower.includes('ferro') || tierLower.includes('iron') || tierLower.includes('bronze')) {
        targetRoleName = '🥉 Ferro / Bronze';
      } else if (tierLower.includes('prata') || tierLower.includes('silver') || tierLower.includes('ouro') || tierLower.includes('gold')) {
        targetRoleName = '🥇 Prata / Ouro';
      } else if (tierLower.includes('platina') || tierLower.includes('platinum') || tierLower.includes('esmeralda') || tierLower.includes('emerald')) {
        targetRoleName = '💚 Platina / Esmeralda';
      } else if (tierLower.includes('diamante') || tierLower.includes('diamond') || tierLower.includes('mestre') || tierLower.includes('master') || tierLower.includes('desafiante') || tierLower.includes('challenger')) {
        targetRoleName = '💎 Diamante / Mestre+';
      }

      if (targetRoleName && interaction.member) {
        const eloRole = interaction.guild.roles.cache.find(r => r.name === targetRoleName);
        if (eloRole) {
          await interaction.member.roles.add(eloRole).catch(() => {});
          roleAssigned = `${eloRole}`;
        }
      }
    } catch (e) {}

    const p = getUserProfile(interaction.user.id);
    p.riotId = fullRiotId;
    p.region = region;
    p.xp += 30; // Bônus por vincular a conta
    saveCommunity(community);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Conta do League of Legends Vinculada!')
      .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
      .setDescription(`Sua conta foi salva no seu perfil da comunidade! Agora você pode usar **\`/perfil-lol\`** e **\`/meu-campeao\`** sem precisar digitar o Nick#TAG toda vez!`)
      .addFields(
        { name: '🎮 Riot ID Salvo', value: `**\`${fullRiotId}\`** (${region.toUpperCase()})`, inline: true },
        { name: '🏆 Elo Detectado', value: `**${detectedTier}**`, inline: true },
        { name: '🎭 Cargo Sincronizado', value: roleAssigned, inline: true }
      )
      .setFooter({ text: 'Você também ganhou +30 XP de bônus na comunidade!' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === 'honrar') {
    const targetUser = interaction.options.getUser('membro');
    const motivo = interaction.options.getString('motivo') || 'Jogou muito bem, manteve a calma e ajudou o time! GG ❤️';

    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ content: '❌ Você não pode dar honra (GG) para si mesmo! Honre um colega de equipe.', ephemeral: true });
    }
    if (targetUser.bot) {
      return interaction.reply({ content: '🤖 Obrigado pela honra, invocador! Mas guarde seus GGs para os membros humanos!', ephemeral: true });
    }

    const lastHonor = community.reputationCooldowns[interaction.user.id] || 0;
    const diffMinutes = Math.ceil((1800000 - (Date.now() - lastHonor)) / 60000);
    if (Date.now() - lastHonor < 1800000) {
      return interaction.reply({
        content: `⏳ Você já honrou alguém recentemente! Aguarde mais **${diffMinutes} min** para enviar outra Honra GG.`,
        ephemeral: true
      });
    }

    community.reputationCooldowns[interaction.user.id] = Date.now();
    const targetProf = getUserProfile(targetUser.id);
    targetProf.ggHonors = (targetProf.ggHonors || 0) + 1;
    targetProf.xp += 50;
    if (targetProf.xp >= targetProf.level * 100) targetProf.level += 1;
    saveCommunity(community);

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🎖️ NOVA HONRA DE PARTIDA (GG ❤️)!')
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      .setDescription(`${interaction.user} concedeu uma **Honra GG ❤️** para ${targetUser}!`)
      .addFields(
        { name: '💬 Motivo do Elogio', value: `*"${motivo}"*`, inline: false },
        { name: '❤️ Total de Honras de ' + targetUser.username, value: `**${targetProf.ggHonors} GGs**`, inline: true },
        { name: '⭐ Bônus Recebido', value: '**+50 XP** na Comunidade', inline: true }
      )
      .setTimestamp();

    await interaction.reply({ content: `🎖️ ${targetUser}`, embeds: [embed] });

    // Se o comando não foi usado no #🎖️・mural-de-honra-gg, posta uma cópia lá também!
    const honorChan = interaction.guild.channels.cache.find(c => c.name.includes('mural-de-honra') && c.type === ChannelType.GuildText);
    if (honorChan && honorChan.id !== interaction.channel.id) {
      await honorChan.send({ content: `🎖️ Nova honra recebida por ${targetUser}!`, embeds: [embed] }).catch(() => {});
    }
    return;
  }

  if (commandName === 'rank-servidor') {
    const targetUser = interaction.options.getUser('membro') || interaction.user;
    const p = getUserProfile(targetUser.id);

    const allUsers = Object.entries(community.users)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => (b.level * 1000 + b.xp) - (a.level * 1000 + a.xp));

    const userRankPos = allUsers.findIndex(u => u.id === targetUser.id) + 1;

    const top10 = allUsers.slice(0, 10).map((u, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${idx + 1}**`;
      const riotBadge = u.riotId ? ` • 🎮 \`${u.riotId}\`` : '';
      return `${medal} <@${u.id}> — **Nível ${u.level}** (\`${u.xp} XP\`) • ❤️ **${u.ggHonors || 0} GG**${riotBadge}`;
    });

    const rankTitle =
      p.level >= 20 ? '👑 Lenda Desafiante' :
      p.level >= 10 ? '💎 Mestre da Comunidade' :
      p.level >= 5 ? '🔥 Veterano da SoloQ' : '⚔️ Invocador em Ascensão';

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`🏆 Cartão da Comunidade & Top 10: ${targetUser.username}`)
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      .setDescription(`🏅 **Título no Servidor:** ${rankTitle} • **Posição Geral:** \`#${userRankPos || 1}\``)
      .addFields(
        { name: '⭐ Nível & XP', value: `**Nível ${p.level}**\n\`${p.xp} / ${p.level * 100} XP\``, inline: true },
        { name: '🎖️ Honras (GG ❤️)', value: `**${p.ggHonors || 0} GGs**\n\`${p.quizWins || 0} Quiz vencidos\``, inline: true },
        { name: '🎮 Conta LoL Vinculada', value: p.riotId ? `**\`${p.riotId}\`** (${(p.region || 'br').toUpperCase()})` : '*Não vinculada (`/vincular-lol`)*', inline: true },
        {
          name: '👑 TOP 10 RANKING DO SERVIDOR (XP & HONRA GG)',
          value: top10.length > 0 ? top10.join('\n') : 'Ninguém pontuou ainda!',
          inline: false
        }
      )
      .setFooter({ text: `Mensagens enviadas por ${targetUser.username}: ${p.messages || 0}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'quiz-lol') {
    const qIdx = Math.floor(Math.random() * LOL_QUIZ.length);
    const qItem = LOL_QUIZ[qIdx];
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🧠 DESAFIO QUIZ LEAGUE OF LEGENDS (+50 XP)')
      .setDescription(`### ${qItem.q}\n\nClique no botão da resposta certa abaixo! Quem acertar primeiro ganha **+50 XP** no servidor!`)
      .setFooter({ text: `Desafio iniciado por ${interaction.user.tag}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      qItem.options.map((optText, idx) =>
        new ButtonBuilder()
          .setCustomId(`quiz_ans_${qIdx}_${idx}`)
          .setLabel(optText)
          .setStyle(ButtonStyle.Primary)
      )
    );
    return interaction.reply({ embeds: [embed], components: [row] });
  }

  if (commandName === 'duelo-1x1') {
    const oponente = interaction.options.getUser('oponente');
    if (oponente.id === interaction.user.id) {
      return interaction.reply({ content: '❌ Você não pode tirar X1 contra a própria sombra (a menos que seja main Zed)! Escolha outro membro!', ephemeral: true });
    }

    const duelChamps = ['Zed', 'Yasuo', 'Yone', 'Irelia', 'Riven', 'Lee Sin', 'Akali', 'Fiora', 'Vayne', 'Draven', 'Sylas', 'Katarina', 'LeBlanc', 'Jax', 'Darius'];
    const c1 = duelChamps[Math.floor(Math.random() * duelChamps.length)];
    const c2 = duelChamps[Math.floor(Math.random() * duelChamps.length)];

    const plays = [
      'desviou da Ultimate com **Flash + Passo Lateral** no último pixel',
      'acertou o combo completo com **Incendiar (Ignite)** e saiu com **12 de vida** mandando Maestria 7',
      'usou **Ampulheta de Zhonya** na hora exata e virou o duelo debaixo da torre',
      'cancelou a animação do ataque básico perfeitamente e garantiu o **First Blood (400g)**',
      'roubou a fruta de mel no rio, deu outplay no mato e solou sem gastar Flash'
    ];
    const chosenPlay = plays[Math.floor(Math.random() * plays.length)];
    const p1Wins = Math.random() < 0.5;
    const winner = p1Wins ? interaction.user : oponente;
    const loser = p1Wins ? oponente : interaction.user;
    const winnerChamp = p1Wins ? c1 : c2;
    const loserChamp = p1Wins ? c2 : c1;

    const winProf = getUserProfile(winner.id);
    winProf.xp += 30;
    if (winProf.xp >= winProf.level * 100) winProf.level += 1;
    saveCommunity(community);

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚔️ ARENA X1 NO RIO (HOWLING ABYSS / MID)')
      .setDescription([
        `🔵 ${interaction.user} (**${c1}**) **VS** 🔴 ${oponente} (**${c2}**)!`,
        '',
        `🔥 **O que aconteceu no X1:**`,
        `${winner} jogando de **${winnerChamp}** ${chosenPlay} contra o **${loserChamp}** de ${loser}!`,
        '',
        `🏆 **VENCEDOR DO X1:** ${winner} (**+30 XP** na Comunidade!)`
      ].join('\n'))
      .setFooter({ text: 'Quer revanche? Use /duelo-1x1 novamente!' })
      .setTimestamp();

    return interaction.reply({ content: `⚔️ ${oponente}, você foi desafiado para um X1 por ${interaction.user}!`, embeds: [embed] });
  }

  if (commandName === 'sugerir') {
    const ideia = interaction.options.getString('ideia');
    const sugChannel = interaction.guild.channels.cache.find(c => c.name.includes('sugestoes') && c.type === ChannelType.GuildText) || interaction.channel;

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setAuthor({ name: `Sugestão de ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTitle('💡 Nova Sugestão para a Comunidade')
      .setDescription(`### ${ideia}\n\nVote abaixo com ✅ (**Apoio**) ou ❌ (**Não apoio**)!`)
      .setFooter({ text: `ID do Autor: ${interaction.user.id}` })
      .setTimestamp();

    const msg = await sugChannel.send({ embeds: [embed] });
    await msg.react('✅').catch(() => {});
    await msg.react('❌').catch(() => {});

    if (sugChannel.id !== interaction.channel.id) {
      return interaction.reply({ content: `✅ Sua sugestão foi publicada para votação em ${sugChannel}!`, ephemeral: true });
    }
    return interaction.reply({ content: '✅ Sugestão registrada com sucesso!', ephemeral: true });
  }

  if (commandName === 'sala') {
    const vc = interaction.member?.voice?.channel;
    if (!vc || !isTempVoiceChannel(vc)) {
      return interaction.reply({
        content: '❌ Você precisa estar conectado na sua **Sala de Voz Temporária** (entre primeiro em `➕・Criar Sala` ou `➕・Criar Call LoL`) para usar este comando!',
        ephemeral: true
      });
    }

    const meta = tempVoiceChannels.get(vc.id);
    const isOwnerOrAdmin =
      (meta && meta.ownerId === interaction.user.id) ||
      interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
      vc.permissionsFor(interaction.member)?.has(PermissionFlagsBits.ManageChannels);

    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '❌ Apenas o **Dono da Sala Temporária** (ou um Admin) pode configurar esta call!',
        ephemeral: true
      });
    }

    const novoNome = interaction.options.getString('nome');
    const novoLimite = interaction.options.getInteger('limite');
    const trancar = interaction.options.getBoolean('trancar');
    const expulsarUser = interaction.options.getUser('expulsar');

    const changes = [];
    try {
      if (novoNome) {
        const formattedName = `✨・${novoNome.slice(0, 24)}`;
        await vc.setName(formattedName);
        changes.push(`✏️ **Nome alterado para:** \`${formattedName}\``);
      }
      if (novoLimite !== null) {
        await vc.setUserLimit(novoLimite);
        changes.push(`👥 **Limite de vagas:** \`${novoLimite === 0 ? 'Sem limite (Livre)' : `${novoLimite} jogadores`}\``);
      }
      if (trancar !== null) {
        await vc.permissionOverwrites.edit(interaction.guild.id, { Connect: trancar ? false : null });
        changes.push(trancar ? '🔒 **Status:** Sala Trancada' : '🔓 **Status:** Sala Destrancada');
      }
      if (expulsarUser) {
        const targetMember = vc.members.get(expulsarUser.id);
        if (targetMember) {
          await targetMember.voice.disconnect('Removido pelo dono da sala temporária');
          await vc.permissionOverwrites.edit(expulsarUser.id, { Connect: false });
          changes.push(`👢 **Expulso da sala:** ${expulsarUser}`);
        } else {
          changes.push(`⚠️ ${expulsarUser} não está nesta call.`);
        }
      }

      if (changes.length === 0) {
        return interaction.reply({
          content: 'ℹ️ Escolha pelo menos uma opção no comando `/sala` (`nome`, `limite`, `trancar` ou `expulsar`) ou use os botões no chat da call!',
          ephemeral: true
        });
      }

      return interaction.reply({
        content: `🎛️ **Configurações da Sala Temporária Atualizadas!**\n${changes.join('\n')}`
      });
    } catch (err) {
      return interaction.reply({ content: `❌ Erro ao configurar sala: ${err.message}`, ephemeral: true });
    }
  }

  if (commandName === 'patch-notes') {
    const lolPatchUrl = 'https://www.leagueoflegends.com/pt-br/news/tags/patch-notes/';
    const tftPatchUrl = 'https://teamfighttactics.leagueoflegends.com/pt-br/news/';

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('📰 Notas de Atualização Oficiais (Patch Notes)')
      .setDescription('Confira todos os **Buffs, Nerfs, Reworks e Skins** da atualização atual do League of Legends e Teamfight Tactics:')
      .addFields(
        { name: '⚔️ League of Legends (PT-BR)', value: `[Ler Notas da Atualização](${lolPatchUrl})`, inline: true },
        { name: '🐧 Teamfight Tactics (TFT)', value: `[Ler Notas do TFT](${tftPatchUrl})`, inline: true }
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Patch Notes LoL (PT-BR)').setStyle(ButtonStyle.Link).setURL(lolPatchUrl).setEmoji('⚔️'),
      new ButtonBuilder().setLabel('Patch Notes TFT').setStyle(ButtonStyle.Link).setURL(tftPatchUrl).setEmoji('🐧')
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  if (commandName === 'sortear-times') {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ Você precisa estar conectado em um **Canal de Voz (Call)** com a galera para sortear os times!',
        ephemeral: true
      });
    }

    const members = Array.from(voiceChannel.members.values()).filter(m => !m.user.bot);
    if (members.length < 2) {
      return interaction.reply({
        content: '❌ Precisa haver pelo menos **2 jogadores** (sem contar bots) na sua call de voz para sortear os times!',
        ephemeral: true
      });
    }

    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [members[i], members[j]] = [members[j], members[i]];
    }

    const half = Math.ceil(members.length / 2);
    const blueTeam = members.slice(0, half);
    const redTeam = members.slice(half);
    const lanesOrder = ['🛡️ TOP', '🌲 JG', '🔮 MID', '🏹 ADC', '❤️ SUP'];

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`🎲 Sorteio de Times (X5 / Personalizada) — ${voiceChannel.name}`)
      .setDescription(`Foram sorteados **${members.length} jogadores** da call de voz!`)
      .addFields(
        {
          name: `🔵 TIME AZUL (${blueTeam.length})`,
          value: blueTeam.map((m, idx) => `${lanesOrder[idx] ? `**${lanesOrder[idx]}:** ` : '• '}${m}`).join('\n') || 'Nenhum',
          inline: true
        },
        {
          name: `🔴 TIME VERMELHO (${redTeam.length})`,
          value: redTeam.map((m, idx) => `${lanesOrder[idx] ? `**${lanesOrder[idx]}:** ` : '• '}${m}`).join('\n') || 'Nenhum',
          inline: true
        }
      )
      .setFooter({ text: `Sorteado por ${interaction.user.tag}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'sortear-campeao') {
    const lane = interaction.options.getString('lane');

    if (lane === 'COMP') {
      const pick = arr => arr[Math.floor(Math.random() * arr.length)];
      const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('🎲 Composição 5v5 Sorteada!')
        .setDescription('Desafio: Joguem a próxima Flex/Normal Game com essa composição:')
        .addFields(
          { name: '🛡️ TOP', value: `**${pick(LOL_CHAMPIONS.TOP)}**`, inline: true },
          { name: '🌲 JUNGLE', value: `**${pick(LOL_CHAMPIONS.JG)}**`, inline: true },
          { name: '🔮 MID', value: `**${pick(LOL_CHAMPIONS.MID)}**`, inline: true },
          { name: '🏹 ADC', value: `**${pick(LOL_CHAMPIONS.ADC)}**`, inline: true },
          { name: '❤️ SUPORTE', value: `**${pick(LOL_CHAMPIONS.SUP)}**`, inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    const pool = lane ? LOL_CHAMPIONS[lane] : [
      ...LOL_CHAMPIONS.TOP,
      ...LOL_CHAMPIONS.JG,
      ...LOL_CHAMPIONS.MID,
      ...LOL_CHAMPIONS.ADC,
      ...LOL_CHAMPIONS.SUP
    ];
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    return interaction.reply({
      content: `🎲 ${interaction.user}, o seu campeão sorteado ${lane ? `para **${lane}**` : ''} é: **🔥 ${chosen} 🔥**! Boa sorte na partida!`
    });
  }

  if (commandName === 'cara-ou-coroa') {
    const isBlue = Math.random() < 0.5;
    const embed = new EmbedBuilder()
      .setColor(isBlue ? 0x3498db : 0xe74c3c)
      .setTitle('🪙 Sorteio de Lado do Mapa (Side Selection)')
      .setDescription(
        isBlue
          ? '🔵 **LADO AZUL (BLUE SIDE / FIRST PICK)** venceu o sorteio!'
          : '🔴 **LADO VERMELHO (RED SIDE / COUNTER PICK)** venceu o sorteio!'
      )
      .setFooter({ text: `Sorteado por ${interaction.user.tag}` })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'enquete') {
    const pergunta = interaction.options.getString('pergunta');
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('📊 ENQUETE / VOTAÇÃO — CLASH LOL')
      .setDescription(`### ${pergunta}\n\nReaja abaixo com ✅ (**Sim / Bora**) ou ❌ (**Não**)!`)
      .setFooter({ text: `Enquete criada por ${interaction.user.tag}` })
      .setTimestamp();

    const pollMsg = await interaction.reply({ embeds: [embed], fetchReply: true });
    await pollMsg.react('✅').catch(() => {});
    await pollMsg.react('❌').catch(() => {});
    return;
  }

  // --- COMANDOS ADMINISTRATIVOS ---
  if (commandName === 'setup-canais') {
    const welcome = interaction.options.getChannel('boas-vindas');
    const leave = interaction.options.getChannel('saida');
    const logs = interaction.options.getChannel('logs');
    const autorole = interaction.options.getRole('autorole');

    if (welcome) config.welcomeChannelId = welcome.id;
    if (leave) config.leaveChannelId = leave.id;
    if (logs) config.logChannelId = logs.id;
    if (autorole) config.autoRoleId = autorole.id;

    saveConfig(config);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('⚙️ Configurações Atualizadas!')
      .addFields(
        { name: '👋 Canal de Boas-vindas', value: config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : 'Não definido', inline: true },
        { name: '🚪 Canal de Saída', value: config.leaveChannelId ? `<#${config.leaveChannelId}>` : 'Mesmo de boas-vindas', inline: true },
        { name: '📋 Canal de Logs', value: config.logChannelId ? `<#${config.logChannelId}>` : 'Não definido', inline: true },
        { name: '🎭 Cargo Automático (Auto-Role)', value: config.autoRoleId ? `<@&${config.autoRoleId}>` : 'Não definido', inline: false }
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'setup-automod') {
    const antiLink = interaction.options.getBoolean('anti-link');
    const antiSpam = interaction.options.getBoolean('anti-spam');

    if (antiLink !== null) config.antiLink = antiLink;
    if (antiSpam !== null) config.antiSpam = antiSpam;
    saveConfig(config);

    return interaction.reply({
      content: `🛡️ **Auto-Moderação Atualizada!**\n• **Anti-Link:** ${config.antiLink ? '✅ Ativado' : '❌ Desativado'}\n• **Anti-Spam:** ${config.antiSpam ? '✅ Ativado' : '❌ Desativado'}`,
      ephemeral: true
    });
  }

  if (commandName === 'painel-cargos') {
    const role = interaction.options.getRole('cargo');
    const titulo = interaction.options.getString('titulo');
    const descricao = interaction.options.getString('descricao');
    const textoBotao = interaction.options.getString('texto-botao') || `Pegar / Remover ${role.name}`;

    const embed = new EmbedBuilder()
      .setColor(role.color || 0x5865f2)
      .setTitle(titulo)
      .setDescription(descricao)
      .setFooter({ text: 'Clique no botão abaixo para ganhar ou remover o cargo!' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`role_btn_${role.id}`)
        .setLabel(textoBotao)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎭')
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Painel de cargo enviado com sucesso!', ephemeral: true });
  }

  if (commandName === 'clear') {
    const amount = interaction.options.getInteger('quantidade');
    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
    if (!deleted) {
      return interaction.reply({ content: '❌ Não foi possível apagar as mensagens.', ephemeral: true });
    }
    return interaction.reply({ content: `🧹 **${deleted.size}** mensagens foram apagadas!`, ephemeral: true });
  }

  if (commandName === 'kick') {
    const target = interaction.options.getMember('membro');
    const reason = interaction.options.getString('motivo') || 'Sem motivo especificado';

    if (!target || !target.kickable) {
      return interaction.reply({ content: '❌ Não posso expulsar este membro.', ephemeral: true });
    }
    await target.kick(reason);
    return interaction.reply({ content: `👢 **${target.user.tag}** foi expulso! Motivo: *${reason}*` });
  }

  if (commandName === 'ban') {
    const target = interaction.options.getMember('membro');
    const reason = interaction.options.getString('motivo') || 'Sem motivo especificado';

    if (!target || !target.bannable) {
      return interaction.reply({ content: '❌ Não posso banir este membro.', ephemeral: true });
    }
    await target.ban({ reason });
    return interaction.reply({ content: `🔨 **${target.user.tag}** foi banido! Motivo: *${reason}*` });
  }

  if (commandName === 'convites') {
    const user = interaction.options.getUser('membro') || interaction.user;
    try {
      const invites = await interaction.guild.invites.fetch();
      const userInvites = invites.filter(inv => inv.inviter && inv.inviter.id === user.id);
      let totalUses = 0;
      userInvites.forEach(inv => { totalUses += inv.uses || 0; });

      return interaction.reply({
        content: `📨 **${user.tag}** possui atualmente **${totalUses}** convites válidos (${userInvites.size} links ativos).`
      });
    } catch (e) {
      return interaction.reply({ content: '❌ Não consegui consultar os convites.', ephemeral: true });
    }
  }

  if (commandName === 'status-config') {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📊 Status da Configuração do Bot — CLASH LOL')
      .addFields(
        { name: '👋 Canal de Boas-vindas', value: config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : 'Não configurado', inline: true },
        { name: '🚪 Canal de Saída', value: config.leaveChannelId ? `<#${config.leaveChannelId}>` : 'Mesmo de boas-vindas', inline: true },
        { name: '📋 Canal de Logs', value: config.logChannelId ? `<#${config.logChannelId}>` : 'Não configurado', inline: true },
        { name: '🎭 Cargo Automático', value: config.autoRoleId ? `<@&${config.autoRoleId}>` : 'Não configurado', inline: true },
        { name: '🔗 Anti-Link', value: config.antiLink ? '✅ Ativado' : '❌ Desativado', inline: true },
        { name: '⚡ Anti-Spam', value: config.antiSpam ? '✅ Ativado' : '❌ Desativado', inline: true }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'auto-estruturar') {
    await interaction.deferReply({ ephemeral: true });
    await autoSetupGuild(interaction.guild, true);
    return interaction.editReply({
      content: '✅ **Servidor turbinado com o pacote MEGA League of Legends!** Confira os novos canais, mural de regras/comandos, tickets e painéis!'
    });
  }
});

(async () => {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const app = await rest.get('/applications/@me');
    const neededFlags = (1 << 13) | (1 << 15) | (1 << 19);
    if (((app.flags || 0) & neededFlags) !== neededFlags) {
      await rest.patch('/applications/@me', {
        body: { flags: (app.flags || 0) | neededFlags }
      });
    }
  } catch (e) {
    console.warn('Aviso ao verificar flags da aplicação:', e.message);
  }
  client.login(process.env.DISCORD_TOKEN);
})();

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const mongoose = require('mongoose');
const { loadCommands, loadEvents } = require('./utils/loader');
const logger = require('./utils/logger');

// Создание клиента Discord с необходимыми интентами
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember
  ]
});

// Создание коллекций для команд и алиасов
client.commands = new Collection();
client.aliases = new Collection();
client.cooldowns = new Collection();
client.config = require('../config');

// Подключение к базе данных MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  logger.info('Успешное подключение к MongoDB');
})
.catch((err) => {
  logger.error(`Ошибка подключения к MongoDB: ${err}`);
});

// Загрузка команд и событий
(async () => {
  try {
    await loadCommands(client);
    await loadEvents(client);
    
    logger.info(`Загружено ${client.commands.size} команд`);
    
    // Запуск бота
    await client.login(process.env.DISCORD_TOKEN);
    logger.info(`Бот ${client.user.tag} успешно запущен!`);
  } catch (error) {
    logger.error(`Ошибка при инициализации бота: ${error}`);
    process.exit(1);
  }
})();

// Обработка необработанных исключений
process.on('unhandledRejection', (error) => {
  logger.error(`Необработанное исключение: ${error}`);
});

// Обработка сигналов завершения для корректного выхода
process.on('SIGINT', () => {
  logger.info('Получен сигнал SIGINT, завершение работы...');
  client.destroy();
  mongoose.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Получен сигнал SIGTERM, завершение работы...');
  client.destroy();
  mongoose.disconnect();
  process.exit(0);
});

// Экспорт клиента для использования в других модулях
module.exports = client;
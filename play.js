const { EmbedBuilder } = require('discord.js');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');

// Хранилище очередей воспроизведения для разных серверов
const queue = new Map();

module.exports = {
  name: 'play',
  aliases: ['p'],
  category: 'music',
  description: 'Воспроизводит музыку из YouTube',
  usage: 'play <название песни или URL>',
  cooldown: 3,
  async execute(message, args, client) {
    // Проверка аргументов
    if (!args.length) {
      return message.reply('Пожалуйста, укажите название песни или URL для воспроизведения.');
    }

    // Проверка, находится ли пользователь в голосовом канале
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply('Вы должны находиться в голосовом канале для использования этой команды.');
    }

    // Проверка прав доступа
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
      return message.reply('У меня нет прав для подключения или воспроизведения музыки в этом канале.');
    }

    // Получение или создание очереди сервера
    const serverQueue = queue.get(message.guild.id);
    const songQuery = args.join(' ');
    let song = {};

    // Проверка, является ли запрос URL или поисковым запросом
    if (ytdl.validateURL(songQuery)) {
      const songInfo = await ytdl.getInfo(songQuery);
      song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
        duration: formatDuration(songInfo.videoDetails.lengthSeconds),
        thumbnail: songInfo.videoDetails.thumbnails[0].url,
        requestedBy: message.author.tag,
      };
    } else {
      // Поиск видео по запросу
      try {
        const videoFinder = async (query) => {
          const videoResult = await ytSearch(query);
          return videoResult.videos.length > 0 ? videoResult.videos[0] : null;
        };

        const video = await videoFinder(songQuery);
        if (video) {
          song = {
            title: video.title,
            url: video.url,
            duration: video.duration.timestamp,
            thumbnail: video.thumbnail,
            requestedBy: message.author.tag,
          };
        } else {
          return message.reply('Не удалось найти видео по вашему запросу.');
        }
      } catch (error) {
        console.error(error);
        return message.reply('Произошла ошибка при поиске видео.');
      }
    }

    // Если очередь не существует, создаем ее
    if (!serverQueue) {
      const queueConstructor = {
        voiceChannel: voiceChannel,
        textChannel: message.channel,
        connection: null,
        player: null,
        songs: [],
        volume: 5,
        playing: true,
      };

      // Добавляем очередь в коллекцию
      queue.set(message.guild.id, queueConstructor);
      queueConstructor.songs.push(song);

      try {
        // Подключение к голосовому каналу
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });
        
        queueConstructor.connection = connection;
        
        // Создание аудиоплеера
        const player = createAudioPlayer();
        queueConstructor.player = player;
        
        // Подписка соединения на плеер
        connection.subscribe(player);
        
        // Начало воспроизведения
        playSong(message.guild.id, queueConstructor.songs[0]);
        
      } catch (error) {
        console.error(error);
        queue.delete(message.guild.id);
        return message.reply('Произошла ошибка при подключении к голосовому каналу.');
      }
    } else {
      // Если очередь существует, добавляем песню в конец
      serverQueue.songs.push(song);
      
      // Отправляем сообщение о добавлении в очередь
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Добавлено в очередь')
        .setDescription(`**[${song.title}](${song.url})**`)
        .setThumbnail(song.thumbnail)
        .addFields(
          { name: 'Продолжительность', value: song.duration, inline: true },
          { name: 'Запросил', value: song.requestedBy, inline: true },
          { name: 'Позиция в очереди', value: `${serverQueue.songs.length - 1}`, inline: true }
        )
        .setTimestamp();
      
      return message.channel.send({ embeds: [embed] });
    }
  },
};

// Функция для воспроизведения песни
async function playSong(guild, song) {
  const serverQueue = queue.get(guild);
  
  if (!song) {
    // Если песен больше нет, отключаемся от канала
    serverQueue.connection.destroy();
    queue.delete(guild);
    return;
  }
  
  try {
    // Создание аудиоресурса из YouTube
    const stream = ytdl(song.url, { 
      filter: 'audioonly', 
      quality: 'highestaudio',
      highWaterMark: 1 << 25 // 32MB буфер
    });
    
    const resource = createAudioResource(stream);
    
    // Воспроизведение аудио
    serverQueue.player.play(resource);
    
    // Обработка события окончания песни
    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
      serverQueue.songs.shift();
      playSong(guild, serverQueue.songs[0]);
    });
    
    // Отправка сообщения о текущей песне
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Сейчас играет')
      .setDescription(`**[${song.title}](${song.url})**`)
      .setThumbnail(song.thumbnail)
      .addFields(
        { name: 'Продолжительность', value: song.duration, inline: true },
        { name: 'Запросил', value: song.requestedBy, inline: true }
      )
      .setTimestamp();
    
    serverQueue.textChannel.send({ embeds: [embed] });
    
  } catch (error) {
    console.error(error);
    serverQueue.textChannel.send('Произошла ошибка при воспроизведении песни.');
    
    // Переходим к следующей песне в случае ошибки
    serverQueue.songs.shift();
    playSong(guild, serverQueue.songs[0]);
  }
}

// Форматирование продолжительности видео
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}
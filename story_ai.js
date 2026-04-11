// story_ai.js
const { getVoiceConnection, joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const poetryQueue = [];
let isPlayingPoetry = false;

module.exports = {
    handleStoryCommands: async function(msg, exactMessage, chatModel, storyPlayerState, startListeningFn) {
        if (exactMessage === "وقف" || exactMessage === "قف" || exactMessage === "اسكت") {
            if (storyPlayerState.player && storyPlayerState.isPlaying) {
                storyPlayerState.player.pause();
                await msg.reply("⏸️ وقفت القصة مؤقتاً.");
                return true;
            }
        }
        if (exactMessage === "كمل" || exactMessage === "استمر") {
            if (storyPlayerState.player && storyPlayerState.isPlaying) {
                storyPlayerState.player.unpause();
                await msg.reply("▶️ كملت القصة.");
                return true;
            }
        }

        const storyMatch = exactMessage.match(/^(?:مودي\s+|حمودي\s+)?(?:قول|عطني|اسرد|ابي|أبي)\s*قصة\s*(.+)?/i);
        if (storyMatch) {
            const requestedGenre = storyMatch[1] ? storyMatch[1].trim() : "عشوائية";
            const vc = msg.member.voice.channel;
            if (!vc) { await msg.reply("❌ لازم تكون في روم صوتي عشان أحكيلك القصة!"); return true; }

            let conn = getVoiceConnection(msg.guild.id);
            if (!conn) {
                conn = joinVoiceChannel({ channelId: vc.id, guildId: vc.guild.id, adapterCreator: vc.guild.voiceAdapterCreator, selfDeaf: false });
                conn.continuousMode = true;
                startListeningFn(conn);
            }
            
            storyPlayerState.connection = conn;
            msg.reply(`📖 جاري البحث عن قصة **${requestedGenre}** حقيقية وترجمتها... جهزوا الشاي ☕`);

            try {
                let subreddit = "shortstories";
                if (requestedGenre.includes("رعب") || requestedGenre.includes("مخيف")) subreddit = "shortscarystories";
                else if (requestedGenre.includes("خيال")) subreddit = "WritingPrompts";
                else if (requestedGenre.includes("غموض")) subreddit = "TheTruthIsHere";

                const res = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=15`);
                const data = await res.json();
                const posts = data.data.children.filter(p => p.data.selftext && p.data.selftext.length > 500);
                if (posts.length === 0) throw new Error("لا توجد قصص");

                const randomPost = posts[Math.floor(Math.random() * posts.length)];
                const chat = chatModel.startChat();
                const translateRes = await chat.sendMessage(`أنت راوي قصص سعودي محترف. ترجم ونظف القصة التالية للعربية الفصحى أو السعودية لتكون ممتعة، بدون إضافات:\n${randomPost.data.selftext.substring(0, 3000)}`);
                
                let arabicStory = translateRes.response.text().trim().replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
                const chunks = arabicStory.match(/.{1,600}(?:\s|$)/g) || [arabicStory];
                
                storyPlayerState.queue = [`اسمعوا هالقصة... بعنوان: ${randomPost.data.title}`, ...chunks, "انتهت القصة، أتمنى تكون عجبتكم."];
                msg.channel.send(`✅ حصلت القصة وتمت الترجمة، بدأت أقراها لكم في الفويس!`);
                
                if (!storyPlayerState.isPlaying) this.processStoryQueue(storyPlayerState);
            } catch (err) {
                console.error("Story Fetch Error:", err);
                msg.channel.send("❌ ما قدرت أسحب قصة حالياً، السيرفرات مسدودة أو التصنيف غير متوفر.");
            }
            return true;
        }

        const poetryMatch = exactMessage.match(/^(?:مودي\s+|حمودي\s+)?(قول شعر|سوي شعر|ألف شعر|الف شعر|عطني شعر|شعر)\s*(?:عن|في)?\s+(.+)/i);
        if (poetryMatch) {
            const topic = poetryMatch[2].trim();
            const vc = msg.member.voice.channel;
            if (!vc) { await msg.reply("❌ لازم تكون في روم صوتي!"); return true; }

            let conn = getVoiceConnection(msg.guild.id);
            if (!conn) {
                conn = joinVoiceChannel({ channelId: vc.id, guildId: vc.guild.id, adapterCreator: vc.guild.voiceAdapterCreator, selfDeaf: false });
                conn.continuousMode = true; startListeningFn(conn);
            }

            msg.reply(`جاري تأليف شعر عن **${topic}**...${isPlayingPoetry ? " (مُضاف للطابور ⏳)" : ""} اسمعني بالروم 🎤`);
            try {
                const chat = chatModel.startChat();
                const res = await chat.sendMessage(`أنت شاعر فحل. اكتب 3-4 أبيات موزونة ومُشكّلة عن: "${topic}". بدون مقدمات.`);
                let poem = res.response.text().trim().replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
                
                poetryQueue.push({ connection: conn, text: "اسمع هالأبيات طال عمرك... \n" + poem.replace(/\n/g, " ،، \n") });
                this.processPoetryQueue();
            } catch (err) { console.error("Poetry Error:", err); }
            return true;
        }
        return false;
    },

    processStoryQueue: async function(state) {
        if (state.queue.length === 0) { state.isPlaying = false; return; }
        state.isPlaying = true;
        
        try {
            const tts = new MsEdgeTTS();
            await tts.setMetadata('ar-SA-HamedNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
            const { audioStream } = tts.toStream(state.queue.shift());
            
            const player = createAudioPlayer();
            state.player = player;
            const resource = createAudioResource(audioStream, { inputType: StreamType.Arbitrary, inlineVolume: true });
            
            if (state.connection) {
                const currentMusic = state.connection.currentMusicPlayer;
                if (currentMusic && currentMusic.state.status === AudioPlayerStatus.Playing) currentMusic.pause();
                
                player.play(resource);
                state.connection.subscribe(player);
                player.on(AudioPlayerStatus.Idle, () => this.processStoryQueue(state));
                player.on('error', () => this.processStoryQueue(state));
            }
        } catch (err) { this.processStoryQueue(state); }
    },

    processPoetryQueue: async function() {
        if (isPlayingPoetry || poetryQueue.length === 0) return;
        isPlayingPoetry = true;
        const task = poetryQueue[0];
        
        const beatsFolder = path.join(__dirname, 'beats');
        if (!fs.existsSync(beatsFolder)) fs.mkdirSync(beatsFolder);
        const beats = fs.readdirSync(beatsFolder).filter(f => f.endsWith('.mp3'));
        
        if(beats.length === 0) {
           // تشغيل بدون ايقاع
           const { playAudio } = require('./voice_ai');
           playAudio(task.connection, task.text, () => { poetryQueue.shift(); isPlayingPoetry = false; this.processPoetryQueue(); });
           return;
        }

        const randomBeat = path.join(beatsFolder, beats[Math.floor(Math.random() * beats.length)]);
        const tts = new MsEdgeTTS();
        await tts.setMetadata('ar-SA-HamedNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(task.text);

        const uniqueId = Date.now();
        const tempTtsPath = path.join(__dirname, `temp_tts_${uniqueId}.mp3`);
        const tempMixPath = path.join(__dirname, `temp_mix_${uniqueId}.mp3`);

        const writeStream = fs.createWriteStream(tempTtsPath);
        audioStream.pipe(writeStream);
        writeStream.on('finish', () => {
            const ffmpegProcess = spawn(ffmpegPath, ['-i', randomBeat, '-i', tempTtsPath, '-filter_complex', '[0:a:0]volume=0.15[bg];[1:a:0]volume=1.5[tts];[bg][tts]amix=inputs=2:duration=shortest[out]', '-map', '[out]', '-y', tempMixPath]);
            ffmpegProcess.on('close', (code) => {
                const fileToPlay = (code === 0 && fs.existsSync(tempMixPath)) ? tempMixPath : tempTtsPath;
                const resource = createAudioResource(fileToPlay, { inlineVolume: true });
                const player = createAudioPlayer();
                
                if (task.connection.currentMusicPlayer) task.connection.currentMusicPlayer.pause();
                player.play(resource);
                task.connection.subscribe(player);

                player.on(AudioPlayerStatus.Idle, () => {
                    if (fs.existsSync(tempMixPath)) fs.unlinkSync(tempMixPath);
                    if (fs.existsSync(tempTtsPath)) fs.unlinkSync(tempTtsPath);
                    if (task.connection.currentMusicPlayer) task.connection.currentMusicPlayer.unpause();
                    poetryQueue.shift(); isPlayingPoetry = false; this.processPoetryQueue();
                });
            });
        });
    }
};
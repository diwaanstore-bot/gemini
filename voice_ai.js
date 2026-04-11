// voice_ai.js
const { EndBehaviorType, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const prism = require('prism-media');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

let isProcessingVoice = false;
const BLACKLISTED_USERS = ["451379187031343104", "944016826751389717"];
const HALLUCINATIONS = ["شكرا", "شكراً", "لكم", "للمشاهدة", "اشتركوا", "اشترك", "القناة", "قناة", "ترجمة", "نانسي", "قنقر", "تول", "اطبتول", "يبرط", "موتي", "عمودي", "يعطيكم العافية"];

module.exports = {
    startListening: function (connection, client, chatModel, GROQ_API_KEY, historyCol, storyPlayerState, playMusicFn, summonerId) {
        const receiver = connection.receiver;
        receiver.speaking.on('start', (userId) => {
            // تجاهل أي شخص غير اللي استدعى البوت
            if (summonerId && userId !== summonerId) return;
            if (userId === client.user.id || BLACKLISTED_USERS.includes(userId)) return;
            
            // لو البوت يعالج صوت حالياً، لا تتداخل الأصوات
            if (isProcessingVoice) {
                console.log(`[Voice] البوت مشغول، تم تجاهل مقطع من: ${userId}`);
                return;
            }
            
            isProcessingVoice = true;
            console.log(`[Voice] 🎤 بدأ التقاط الصوت من: ${userId}`);

            const stream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 } });
            const buffers = [];
            const pcm = stream.pipe(new prism.opus.Decoder({ rate: 48000, channels: 2 }));
            
            pcm.on('error', (err) => { 
                if (!err.message.includes('corrupted')) console.error("PCM Decoder Error:", err); 
            });
            
            pcm.on('data', (c) => buffers.push(c));
            
            pcm.on('end', async () => {
                const audio = Buffer.concat(buffers);
                
                // نرجعه 100 ألف عشان يتجاهل الأنفاس والإزعاج الخفيف
                if (audio.length < 100000) { 
                    console.log(`[Voice] ⚠️ المقطع قصير جداً أو إزعاج خفيف (${audio.length} bytes)، تم تجاهله.`);
                    isProcessingVoice = false; 
                    return; 
                }

                console.log(`[Voice] ⏳ جاري إرسال المقطع (${audio.length} bytes) لـ Groq...`);
                const wav = Buffer.concat([getWavHeader(audio.length), audio]);
                
                try {
                    const text = await transcribeBuffer(wav, GROQ_API_KEY);
                    if (!text) { 
                        console.log("[Voice] ❌ Groq لم يتعرف على أي نص.");
                        isProcessingVoice = false; 
                        return; 
                    }
                    
                    const clean = text.trim().replace(/[.,!?،؟]/g, "");
                    const isHallucination = HALLUCINATIONS.some(word => clean.includes(word) && clean.split(" ").length <= 4);
                    
                    if (isHallucination || clean.length < 2) { 
                        console.log(`[Voice] 🚫 تم تجاهل هلوسة أو نص غير مفهوم: "${clean}"`);
                        isProcessingVoice = false; 
                        return; 
                    }

                    console.log(`[Voice] ✅ سمع من ${userId}: "${clean}"`);
                    
                    const stopMusicRegex = /^(?:مودي\s+|حمودي\s+)?(وقف)(?:\s+(الاغنيه|الاغنية|المقطع))?$/i;
                    const playRegex = /^(?:مودي\s+|حمودي\s+)?شغل\s+(.+)/i;
                    const leaveRegex = /^(?:مودي\s+|حمودي\s+)?(اخرج|أخرج|اطلع|غادر)/i;
                    const muteRegex = /^(?:مودي\s+|حمودي\s+)?(اسكت|أسكت|اصمت|أصمت|انطم|ولا كلمة)/i;
                    const unmuteRegex = /^(?:مودي\s+|حمودي\s+)?(تكلم|اهرج|أهرج|سولف|ارجع|اصحى|رد)/i;

                    const musicPlayer = connection.currentMusicPlayer;
                    const isPlayingMusic = musicPlayer && musicPlayer.state.status === AudioPlayerStatus.Playing;

                    if (isPlayingMusic || storyPlayerState.isPlaying) {
                        if (stopMusicRegex.test(clean)) {
                            if (musicPlayer) musicPlayer.stop();
                            if (storyPlayerState.player) storyPlayerState.player.pause();
                        } else if (leaveRegex.test(clean)) {
                            connection.destroy();
                        }
                        isProcessingVoice = false;
                        return;
                    }

                    if (stopMusicRegex.test(clean)) { if (musicPlayer) musicPlayer.stop(); isProcessingVoice = false; return; }
                    if (leaveRegex.test(clean)) { connection.destroy(); isProcessingVoice = false; return; }
                    if (playRegex.test(clean)) { playMusicFn(connection, clean.match(playRegex)[1].trim()); isProcessingVoice = false; return; }
                    
                    if (muteRegex.test(clean)) {
                        connection.continuousMode = false;
                        playAudio(connection, "حاضر طال عمرك، بسكت وما أرد إلا إذا ناديتني.");
                        isProcessingVoice = false; return;
                    }
                    if (unmuteRegex.test(clean)) {
                        connection.continuousMode = true;
                        playAudio(connection, "أبشر، أنا معاك على الخط وأسمع كل شيء.");
                        isProcessingVoice = false; return;
                    }

                    let commandText = clean;
                    let hasWakeWord = /^م?حمودي\s*/i.test(clean) || clean === "مودي" || clean === "حمودي";
                    if (hasWakeWord) commandText = clean.replace(/^م?حمودي\s*/i, "");

                    if (!connection.continuousMode && !hasWakeWord) { isProcessingVoice = false; return; }
                    if (commandText === "") { isProcessingVoice = false; return; }

                    console.log(`[Voice] 🧠 جاري التفكير للرد على: "${commandText}"`);
                    const messages = await historyCol.find({ userId }).sort({ timestamp: 1 }).toArray();
                    const chatHistory = messages.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
                    
                    const chat = chatModel.startChat({ history: chatHistory });
                    const res = await chat.sendMessage(`المستخدم قال: "${commandText}"\nرد بلهجة سعودية طبيعية وعفوية بدون أي إيموجي.`);
                    let reply = res.response.text().trim().replace(/\[الرد النهائي\]/g, '').replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
                    
                    const now = new Date();
                    await historyCol.insertOne({ userId, role: 'user', content: commandText, timestamp: now, expireAt: new Date(now.getTime() + 60 * 60 * 1000) });
                    await historyCol.insertOne({ userId, role: 'model', content: reply, timestamp: now, expireAt: new Date(now.getTime() + 60 * 60 * 1000) });

                    playAudio(connection, reply);
                    isProcessingVoice = false;

                } catch (e) {
                    console.error("[Voice] خطأ غير متوقع:", e);
                    isProcessingVoice = false;
                }
            });
        });
    },
    playAudio
};

async function transcribeBuffer(buffer, GROQ_API_KEY) {
    try {
        const formData = new FormData();
        const blob = new Blob([buffer], { type: 'audio/wav' });
        
        formData.append('file', blob, 'audio.wav');
        formData.append('model', 'whisper-large-v3-turbo');
        formData.append('language', 'ar');

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: formData
        });

        // هذا السطر اللي بيريحنا، بيعلمنا وش عذر Groq الحقيقي
        if (!response.ok) {
            console.error("\n❌ [خطأ من Groq API]:", await response.text(), "\n");
            return "";
        }

        const data = await response.json();
        return data.text || "";
    } catch (error) {
        console.error("Transcription Error:", error);
        return "";
    }
}

// هذي الدالة اللي انحذفت بالغلط وهي أساس الملف
function getWavHeader(length) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + length, 4);
    header.write('WAVE', 8); header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22); header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(48000 * 4, 28); header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34); header.write('data', 36);
    header.writeUInt32LE(length, 40);
    return header;
}

async function playAudio(connection, text, onComplete) {
    try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata('ar-SA-HamedNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(text);
        const ttsPlayer = createAudioPlayer();
        const resource = createAudioResource(audioStream, { inputType: StreamType.Arbitrary, inlineVolume: true });
        resource.volume.setVolume(1.0);

        const musicPlayer = connection.currentMusicPlayer;
        const wasPlayingMusic = musicPlayer && musicPlayer.state.status === AudioPlayerStatus.Playing;
        if (wasPlayingMusic) musicPlayer.pause();

        ttsPlayer.play(resource);
        connection.subscribe(ttsPlayer);

        ttsPlayer.on(AudioPlayerStatus.Idle, () => {
            if (wasPlayingMusic && connection.currentMusicPlayer) {
                connection.subscribe(connection.currentMusicPlayer);
                connection.currentMusicPlayer.unpause();
            }
            if (onComplete) onComplete();
        });
    } catch (err) { console.error("TTS Error:", err); if (onComplete) onComplete(); }
}
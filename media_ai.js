// media_ai.js
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const { getVoiceConnection, joinVoiceChannel } = require('@discordjs/voice');

module.exports = async function handleMediaCommands(msg, exactMessage, chatModel, startListeningFn, playMusicFn) {
    // 1. توليد الصور
    const imageMatch = exactMessage.match(/^(?:مودي\s+|حمودي\s+)?(?:سوي|ارسم|تخيل)\s+صورة\s+(.+)/i);
    if (imageMatch) {
        const userPrompt = imageMatch[1].trim();
        const loadingMsg = await msg.reply("⏳ جاري الرسم... عطني ثواني أضبطها لك!");
        try {
            const chat = chatModel.startChat();
            const res = await chat.sendMessage(`Translate the following image description to a very detailed English artistic prompt: "${userPrompt}"`);
            const englishPrompt = res.response.text().trim();

            const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishPrompt)}?width=1024&height=1024&nologo=true`;
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data, 'binary');
            const attachment = new AttachmentBuilder(buffer, { name: 'generated-image.jpg' });

            const embed = new EmbedBuilder()
                .setTitle("✨ رسمت لك اللي في بالك!")
                .setDescription(`**الطلب:** ${userPrompt}`)
                .setImage('attachment://generated-image.jpg')
                .setColor("#00ffcc")
                .setFooter({ text: "بواسطة حمودي المبدع" });

            await loadingMsg.edit({ content: null, embeds: [embed], files: [attachment] });
        } catch (err) {
            console.error("Image Gen Error:", err);
            await loadingMsg.edit("❌ والله السيرفر حق الصور معلق أو الوصف مرفوض، جرب شيء ثاني.");
        }
        return true; // تمت معالجة الأمر
    }

    // 2. توليد الأغاني
    const songMatch = exactMessage.match(/^(?:مودي\s+|حمودي\s+)?(?:سوي|ألف|لحن)\s+أغنية\s+(.+)/i);
    if (songMatch) {
        const topic = songMatch[1].trim();
        const vc = msg.member.voice.channel;
        const statusMsg = await msg.reply("⏳ جاري كتابة الكلمات وتلحين الأغنية... بياخذ الموضوع دقيقة تقريباً 🎤");

        try {
            const songPrompt = `اكتب كلمات أغنية قصيرة (بيتين وقرار) عن "${topic}". اقترح "style" موسيقي بالإنجليزية. أرجع النتيجة JSON كالتالي: {"lyrics": "الكلمات", "style": "الستايل"}`;
            const chat = chatModel.startChat();
            const result = await chat.sendMessage(songPrompt);
            const songData = JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, '').trim());

            const sunoApiUrl = process.env.SUNO_API_URL;
            const response = await axios.post(`${sunoApiUrl}/api/custom_generate`, {
                prompt: songData.lyrics, tags: songData.style, title: topic, make_instrumental: false, wait_audio: true
            });

            const songUrl = response.data[0].audio_url;

            if (vc) {
                let conn = getVoiceConnection(msg.guild.id);
                if (!conn) {
                    conn = joinVoiceChannel({ channelId: vc.id, guildId: vc.guild.id, adapterCreator: vc.guild.voiceAdapterCreator, selfDeaf: false });
                    conn.continuousMode = true; startListeningFn(conn);
                }
                await statusMsg.edit("✅ الأغنية جاهزة! بشغلها لك الحين بالفويس.");
                playMusicFn(conn, songUrl);
            } else {
                await statusMsg.edit({ content: "✅ هذي أغنيتك يا فنان!", files: [songUrl] });
            }
        } catch (err) {
            console.error("Music Gen Error:", err);
            await statusMsg.edit("❌ الملحن واجه مشكلة.. تأكد إن رابط Suno API شغال.");
        }
        return true;
    }

    return false;
};
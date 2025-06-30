// test.js - Obsidian olmadan, doğrudan Node.js'te çalıştırmak için.
// BU SÜRÜM, CORS PROXY KULLANIMINI TEST ETMEK İÇİN GÜNCELLENMİŞTİR.

const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node'); // Node.js için http
const fs = require('fs');                         // Node.js'in kendi dosya sistemi
const path = require('path');

// Test için geçici bir klasör yolu belirliyoruz
const testDir = path.join(__dirname, 'test-repo-node');

// Test fonksiyonu
async function testCloneNode() {
    console.log('Node.js test klonlama işlemi başlıyor...');

    // Her testten önce temiz bir başlangıç yapmak için,
    // eğer test klasörü varsa, onu silip yeniden oluşturuyoruz.
    if (fs.existsSync(testDir)) {
        console.log(`Mevcut test klasörü siliniyor: ${testDir}`);
        fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir);
    console.log(`Test klasörü oluşturuldu: ${testDir}`);

    // --- LÜTFEN BU BİLGİLERİ DOLDURUN ---
    const testRepoUrl = 'https://gitea.example.com/user/repo.git';
    const testPat = 'PAT'; // Test için oluşturduğunuz PAT
    const corsProxyUrl = 'https://cors.isomorphic-git.org'; // Test edilecek proxy sunucusu
    // ------------------------------------

    if (testPat === 'ghp_...') {
        console.error("Lütfen test.js dosyasındaki 'testPat' değişkenine geçerli bir Kişisel Erişim Belirteci (PAT) girin.");
        return;
    }

    // Proxy URL'sini ve depo URL'sini birleştir
    // Proxy URL'sinin sonunda / varsa kaldırır ve sonra depo URL'sini ekler.
    const proxiedUrl = `${corsProxyUrl.replace(/\/$/, '')}/${testRepoUrl}`;
    console.log(`Proxy ile istek gönderilecek URL: ${proxiedUrl}`);


    try {
        await git.clone({
            fs: fs, // Node'un kendi 'fs' modülünü kullanıyoruz
            http,
            dir: testDir, // Doğrudan dosya sistemi yolu
            url: proxiedUrl, // GÜNCELLEME: Proxy üzerinden oluşturulan URL'yi kullan
            ref: 'main',
            singleBranch: true,
            depth: 1,
            onAuth: () => ({
                username: 'x-oauth-basic',
                password: testPat,
            }),
        });
        console.log('✅ Klonlama başarılı! "test-repo-node" klasörü dolduruldu.');

        // Klonlanan depo içeriğini listele
        const files = fs.readdirSync(testDir);
        console.log('Klonlanan depo içeriği:', files);

    } catch (error) {
        console.error('❌ Test sırasında hata oluştu:', error);
    }
}

// Testi çalıştır
testCloneNode();

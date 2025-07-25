import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

interface GitMobilSettings {
	repoUrl: string;
	pat: string;
	branchName: string;
	commitMessage: string;
    authorName: string;
    authorEmail: string;
	initialWarningShown: boolean;
    corsProxy: string;
}

const DEFAULT_SETTINGS: GitMobilSettings = {
	repoUrl: '',
	pat: '',
	branchName: 'main',
	commitMessage: 'Obsidian notları güncellendi - {date} {time}',
    authorName: 'Memoria Sync',
    authorEmail: 'memoria@example.com',
	initialWarningShown: false,
    corsProxy: '',
}


export default class GitMobilPlugin extends Plugin {
	settings: GitMobilSettings;
	// @ts-ignore
	fs = this.app.vault.adapter;
	// @ts-ignore
	dir = this.app.vault.adapter.getBasePath();

	async onload() {
        console.log('Memoria Sync eklentisi yükleniyor...');
		await this.loadSettings();
		this.addSettingTab(new GitMobilSettingTab(this.app, this));
        this.checkAndShowInitialWarning();

		this.addCommand({
			id: 'memoria-sync-commit-push',
			name: 'Memoria Sync: Değişiklikleri Kaydet ve Gönder (Commit & Push)',
			callback: async () => {
				await this.gitCommitAll('Manuel Commit & Push');
				await this.gitPush();
			}
		});

		this.addCommand({
			id: 'memoria-sync-pull',
			name: 'Memoria Sync: En Son Değişiklikleri Çek (Pull)',
			callback: async () => {
				await this.gitPull();
			}
		});

		console.log('Memoria Sync eklentisi başarıyla yüklendi.');
	}

    private getGitOptions(overrides: object = {}) {
        const url = this.settings.corsProxy 
            ? `${this.settings.corsProxy.replace(/\/$/, '')}/${this.settings.repoUrl}`
            : this.settings.repoUrl;

        if (this.settings.corsProxy) {
            console.log(`CORS Proxy kullanılıyor: ${this.settings.corsProxy}`);
        }

        return {
            fs: this.fs,
            http,
            dir: this.dir,
            url: url,
            onAuth: () => ({
                username: 'x-oauth-basic', 
                password: this.settings.pat,
            }),
            ...overrides,
        };
    }

	async testConnection(): Promise<{success: boolean; message: string; data?: any}> {
		if (!this.settings.repoUrl || !this.settings.pat) {
			return { success: false, message: 'Lütfen Depo URL\'si ve Erişim Belirteci alanlarını doldurun.' };
		}
        
        new Notice('Bağlantı test ediliyor...');
		try {
            const options = this.getGitOptions();
			const remoteInfo = await git.getRemoteInfo(options);

            let message = 'Bağlantı ve kimlik doğrulama başarılı!';
            if (remoteInfo.refs?.heads && remoteInfo.refs.heads[this.settings.branchName]) {
                 message += ` '${this.settings.branchName}' branch'i uzak depoda bulundu.`;
            } else {
                 message += ` UYARI: '${this.settings.branchName}' branch'i uzak depoda bulunamadı!`;
            }
			return { success: true, message: message, data: remoteInfo };
		} catch (e) {
			console.error("Memoria Sync - Bağlantı Testi Hatası:", e); 
            let errorMessage = this.getFriendlyErrorMessage(e);
			return { success: false, message: `Hata: ${errorMessage}` };
		}
	}

    getFriendlyErrorMessage(e: any): string {
        if (e.message?.toLowerCase().includes('failed to fetch')) {
            const corsMessage = "Ayarlar'dan bir CORS proxy (örn: https://cors.isomorphic-git.org) ayarlamayı deneyin veya masaüstü uygulamasında proxy'yi boş bırakın.";
            return `Ağ hatası: Sunucuya ulaşılamadı. Bu, bir CORS ilkesi veya ağ sorunudur. ${corsMessage} Detaylar için geliştirici konsolunu kontrol edin.`;
        }
        if (e.code === 'HTTPError' || e.name === 'HttpError') {
            const statusCode = e.data?.statusCode || e.response?.status;
            if (statusCode === 401 || statusCode === 403) {
                return "Kimlik doğrulama başarısız (403 Forbidden). PAT geçersiz, süresi dolmuş veya gerekli 'repo' izinlerine sahip değil. Deponuz bir organizasyona aitse SSO yetkilendirmesini kontrol edin.";
            } else if (statusCode === 404) {
                return "Depo bulunamadı. Lütfen URL'yi kontrol edin.";
            }
        }
        if (e.code === 'ENOTFOUND') {
            return "Sunucu bulunamadı. URL'yi veya internet bağlantınızı kontrol edin.";
        }
        return e.message;
    }
    
    checkAndShowInitialWarning() {
        if (!this.settings.initialWarningShown) {
            const notice = new Notice(document.createDocumentFragment(), 0);
            const message = notice.noticeEl.createDiv({ cls: "git-mobil-notice" });
            message.createEl("h3", { text: "Önemli Bilgilendirme: Notlarınızın Güvenliği İçin!" });
            message.createEl("p", { text: "Bu eklenti, notlarınızı Git ile versiyonlamanızı sağlar. Veri kaybı riskini en aza indirmek için lütfen talimatları dikkatlice takip edin ve mevcut notlarınızın manuel bir yedeğini alın." });
            const buttonContainer = notice.noticeEl.createDiv();
            const settingsButton = buttonContainer.createEl("button", { text: "Ayarlara Git", cls: "notice-button" });
            settingsButton.onclick = () => { this.app.setting.open(); this.app.setting.openTabById(this.manifest.id); notice.hide(); };
            const dismissButton = buttonContainer.createEl("button", { text: "Kapat", cls: "notice-button" });
            dismissButton.onclick = () => notice.hide();
            this.settings.initialWarningShown = true;
            this.saveSettings();
        }
    }

	async gitInit() {
		new Notice('Git deposu başlatılıyor...');
		try {
			await git.init({ fs: this.fs, dir: this.dir });
			new Notice('Git deposu başarıyla başlatıldı!');
		} catch (e) {
			console.error("Memoria Sync - Git Init Hatası:", e);
			new Notice(`Hata: ${this.getFriendlyErrorMessage(e)}`);
		}
	}

	async gitClone() {
		if (!this.settings.repoUrl || !this.settings.pat) {
			new Notice('Lütfen depo URL\'sini ve Erişim Belirtecini (PAT) ayarlardan girin.');
			return;
		}
		new Notice('Depo klonlanıyor...');
		try {
            const options = this.getGitOptions({
                ref: this.settings.branchName,
                singleBranch: true,
                depth: 1,
            });
			await git.clone(options);
			new Notice('Depo başarıyla klonlandı!');
			const files = await this.fs.list(this.dir);
			if (files.files.length === 0 && files.folders.length === 1 && files.folders[0].endsWith('.git')) {
                new Notice('Boş bir depo klonlandı. İlk commit oluşturuluyor...');
                await this.gitCommitAll('İlk Obsidian Notları Yedeği');
                await this.gitPush();
            }
		} catch (e) {
			console.error("Memoria Sync - Klonlama Hatası:", e);
			new Notice(`Klonlama hatası: ${this.getFriendlyErrorMessage(e)}`, 10000);
		}
	}

	async gitCommitAll(message?: string) {
        new Notice('Değişiklikler kaydediliyor (commit)...');
		try {
            const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
            const filesToCommit = status.filter(([filepath, ...statuses]) => statuses[1] !== 1 || statuses[2] !== 1);
            
            if (filesToCommit.length === 0) {
                new Notice('Kaydedilecek yeni değişiklik bulunmuyor.');
                return;
            }

            await Promise.all(
                filesToCommit.map(([filepath]) => git.add({ fs: this.fs, dir: this.dir, filepath }))
            );
            
			const commitMessage = (message || this.settings.commitMessage)
				.replace('{date}', new Date().toLocaleDateString())
				.replace('{time}', new Date().toLocaleTimeString());

			const sha = await git.commit({
				fs: this.fs,
				dir: this.dir,
				message: commitMessage,
				author: { name: this.settings.authorName, email: this.settings.authorEmail }
			});
			new Notice(`Değişiklikler başarıyla kaydedildi! Commit: ${sha.slice(0, 7)}`);
		} catch (e) {
			console.error("Memoria Sync - Commit Hatası:", e);
			new Notice(`Commit hatası: ${this.getFriendlyErrorMessage(e)}`, 10000);
		}
	}

	async gitPush() {
		new Notice('Değişiklikler gönderiliyor (push)...');
		try {
            const options = this.getGitOptions();
			const result = await git.push(options);
			if (result.ok) {
				new Notice('Değişiklikler başarıyla gönderildi!');
			} else {
                // Daha anlamlı bir hata mesajı için
                const errorDetails = result.errors ? result.errors.join(', ') : 'Bilinmeyen hata.';
				throw new Error(`Push işlemi başarısız: ${errorDetails}`);
			}
		} catch (e) {
			console.error("Memoria Sync - Push Hatası:", e);
			new Notice(`Push hatası: ${this.getFriendlyErrorMessage(e)}`, 10000);
		}
	}

	async gitPull() {
		new Notice('Değişiklikler çekiliyor (pull)...');
		try {
            const options = this.getGitOptions({
                ref: this.settings.branchName,
                singleBranch: true,
                author: { name: this.settings.authorName, email: this.settings.authorEmail },
            });
			await git.pull(options);
			new Notice('Değişiklikler başarıyla çekildi ve birleştirildi!');
		} catch (e) {
			console.error("Memoria Sync - Pull Hatası:", e);
			new Notice(`Pull hatası: ${this.getFriendlyErrorMessage(e)}`, 10000);
		}
	}

	onunload() {
		console.log('Memoria Sync eklentisi kaldırılıyor...');
	}
	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
	async saveSettings() { await this.saveData(this.settings); }
}

class GitMobilSettingTab extends PluginSettingTab {
	plugin: GitMobilPlugin;

	constructor(app: App, plugin: GitMobilPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Memoria Sync Ayarları' });

        new Setting(containerEl)
			.setName('Git Deposu URL\'si')
			.setDesc('Notlarınızın yedekleneceği uzak Git deposunun tam URL\'si.')
			.addText(text => text
				.setPlaceholder('https://github.com/kullanici/repo.git')
				.setValue(this.plugin.settings.repoUrl)
				.onChange(async (value) => {
					this.plugin.settings.repoUrl = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Erişim Belirteci (PAT)')
			.setDesc('Git servisinizden (GitHub, GitLab vb.) oluşturduğunuz kişisel erişim belirteci.')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setPlaceholder('ghp_xxxxxxxxxxxxxxxxxxxx')
					.setValue(this.plugin.settings.pat)
					.onChange(async (value) => {
						this.plugin.settings.pat = value.trim();
						await this.plugin.saveSettings();
					});
			});

        new Setting(containerEl)
            .setName('CORS Proxy Sunucusu')
            .setDesc(
                "Ağ hatalarını (özellikle 'failed to fetch') çözmek için bir proxy sunucusu kullanın. Mobil cihazlarda genellikle gereklidir. Örn: https://cors.isomorphic-git.org"
            )
            .addText((text) =>
                text
                    .setPlaceholder('İsteğe bağlı')
                    .setValue(this.plugin.settings.corsProxy)
                    .onChange(async (value) => {
                        this.plugin.settings.corsProxy = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        containerEl.createEl('h3', { text: 'Operasyonel Ayarlar' });
		new Setting(containerEl)
			.setName('Hedef Branch Adı')
			.setDesc('Git işlemlerinin yapılacağı branch\'in adı.')
			.addText(text => text
				.setValue(this.plugin.settings.branchName)
				.onChange(async (value) => {
					this.plugin.settings.branchName = value.trim() || 'main';
					await this.plugin.saveSettings();
				}));
        
        new Setting(containerEl)
			.setName('Varsayılan Commit Mesajı')
			.setDesc('{date} ve {time} yer tutucularını kullanabilirsiniz.')
			.addText(text => text
				.setValue(this.plugin.settings.commitMessage)
				.onChange(async (value) => {
					this.plugin.settings.commitMessage = value || DEFAULT_SETTINGS.commitMessage;
					await this.plugin.saveSettings();
				}));

        containerEl.createEl('h3', { text: 'Bağlantı Testi' });
        const validationEl = containerEl.createDiv();
        new Setting(containerEl)
            .setName("Ayarları Doğrula")
            .setDesc("Girdiğiniz bilgilerin doğruluğunu uzak sunucuya bağlanarak test edin.")
            .addButton(button => button
                .setButtonText("Bağlantıyı Test Et")
                .setCta()
                .onClick(async () => {
                    const result = await this.plugin.testConnection();
                    const statusEl = validationEl.querySelector('.validation-status') || validationEl.createDiv({ cls: 'validation-status' });
                    statusEl.setText(result.message);
                    statusEl.className = 'validation-status';
                    if (result.success) {
                        statusEl.addClass('validation-success');
                    } else {
                        statusEl.addClass('validation-error');
                    }
                }));

        containerEl.createEl('h3', { text: 'Durum ve Eylemler' });
        const statusEl = containerEl.createEl("div");
        this.renderStatusAndActions(statusEl);
	}

    async renderStatusAndActions(containerEl: HTMLElement) {
        containerEl.empty();
        
        let gitRepoExists = false;
        try {
            // @ts-ignore
            await this.plugin.fs.stat(this.plugin.dir + '/.git');
            gitRepoExists = true;
        } catch (e) {
            gitRepoExists = false;
        }

        const statusContainer = new Setting(containerEl).setName("Mevcut Durum");
        const actionContainer = new Setting(containerEl);

        if (gitRepoExists) {
            statusContainer.setDesc("Bu kasada bir Git deposu mevcut.");
            
            actionContainer.addButton(button => button
                .setButtonText("Değişiklikleri Kaydet (Commit)")
                .setCta()
                .setClass("git-mobil-button")
                .onClick(() => this.plugin.gitCommitAll()));
            
            actionContainer.addButton(button => button
                .setButtonText("Gönder (Push)")
                .setCta()
                .setClass("git-mobil-button")
                .onClick(() => this.plugin.gitPush()));
                
            actionContainer.addButton(button => button
                .setButtonText("Çek (Pull)")
                .setCta()
                .setClass("git-mobil-button")
                .onClick(() => this.plugin.gitPull()));

        } else {
            statusContainer.setDesc("Bu kasada bir Git deposu bulunmuyor.");

            actionContainer.addButton(button => button
                .setButtonText("Uzak Depoyu Klonla")
                .setTooltip("Ayarlarda belirtilen URL'den depoyu klonlar.")
                .setCta()
                .setClass("git-mobil-button")
                .onClick(() => {
                    this.plugin.gitClone().then(() => this.display());
                }));
                
            actionContainer.addButton(button => button
                .setButtonText("Yeni Yerel Depo Başlat")
                .setTooltip("Bu kasada yeni bir Git deposu başlatır.")
                .setClass("git-mobil-button")
                .onClick(() => {
                    this.plugin.gitInit().then(() => this.display());
                }));
        }
    }
}
import { App, Notice, Plugin, PluginSettingTab, Setting, ButtonComponent } from 'obsidian';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

// Eklenti ayarları için arayüz
interface GitMobilSettings {
	repoUrl: string;
	pat: string;
	branchName: string;
	commitMessage: string;
    authorName: string;
    authorEmail: string;
	initialWarningShown: boolean;
}

// Varsayılan ayarlar
const DEFAULT_SETTINGS: GitMobilSettings = {
	repoUrl: '',
	pat: '',
	branchName: 'main',
	commitMessage: 'Obsidian notları güncellendi - {date} {time}',
    authorName: 'Obsidian Git Mobil',
    authorEmail: 'obsidian@example.com',
	initialWarningShown: false
}

export default class GitMobilPlugin extends Plugin {
	settings: GitMobilSettings;
	// @ts-ignore
	fs = this.app.vault.adapter;
	// @ts-ignore
	dir = this.app.vault.adapter.getBasePath();

	async onload() {
		console.log('Git Mobil eklentisi yükleniyor...');
		await this.loadSettings();

		this.addSettingTab(new GitMobilSettingTab(this.app, this));

        this.checkAndShowInitialWarning();

		this.addCommand({
			id: 'git-mobil-commit-push',
			name: 'Git: Değişiklikleri Kaydet ve Gönder (Commit & Push)',
			callback: async () => {
				await this.gitCommitAll('Manuel Commit & Push');
				await this.gitPush();
			}
		});

		this.addCommand({
			id: 'git-mobil-pull',
			name: 'Git: En Son Değişiklikleri Çek (Pull)',
			callback: async () => {
				await this.gitPull();
			}
		});

		console.log('Git Mobil eklentisi başarıyla yüklendi.');
	}

    checkAndShowInitialWarning() {
        if (!this.settings.initialWarningShown) {
            const notice = new Notice(document.createDocumentFragment(), 0); // 0 = kalıcı
            const message = notice.noticeEl.createDiv({ cls: "git-mobil-notice" });
            message.createEl("h3", { text: "Önemli Bilgilendirme: Notlarınızın Güvenliği İçin!" });
            message.createEl("p", { text: "Bu eklenti, notlarınızı Git ile versiyonlamanızı sağlar. Veri kaybı riskini en aza indirmek için lütfen talimatları dikkatlice takip edin ve mevcut notlarınızın manuel bir yedeğini alın." });

            const buttonContainer = notice.noticeEl.createDiv();
            const settingsButton = buttonContainer.createEl("button", { text: "Ayarlara Git", cls: "notice-button" });
            settingsButton.onclick = () => {
                this.app.setting.open();
                this.app.setting.openTabById(this.manifest.id);
                notice.hide();
            };

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
			console.error(e);
			new Notice(`Hata: ${e.message}`);
		}
	}

	async gitClone() {
		if (!this.settings.repoUrl || !this.settings.pat) {
			new Notice('Lütfen depo URL\'sini ve Erişim Belirtecini (PAT) ayarlardan girin.');
			return;
		}
		new Notice('Depo klonlanıyor... Bu işlem biraz sürebilir.');
		try {
			await git.clone({
				fs: this.fs,
				http,
				dir: this.dir,
				url: this.settings.repoUrl,
				ref: this.settings.branchName,
				singleBranch: true,
				depth: 1,
				onAuth: () => ({ username: this.settings.pat })
			});
			new Notice('Depo başarıyla klonlandı!');
            
            // Boş depo kontrolü
			const files = await this.fs.list(this.dir);
			if (files.files.length === 0 && files.folders.length === 1 && files.folders[0].endsWith('.git')) {
                new Notice('Boş bir depo klonlandı. İlk commit oluşturuluyor...');
                await this.gitCommitAll('İlk Obsidian Notları Yedeği');
                await this.gitPush();
            }

		} catch (e) {
			console.error(e);
            let errorMessage = `Klonlama hatası: ${e.message}`;
            if (e.data?.statusCode === 401 || e.data?.statusCode === 403) {
                errorMessage = "Kimlik doğrulama başarısız. Erişim Belirtecinizi (PAT) kontrol edin.";
            } else if (e.data?.statusCode === 404) {
                errorMessage = "Depo bulunamadı. Lütfen URL'yi kontrol edin.";
            }
			new Notice(errorMessage, 10000);
		}
	}

	async gitCommitAll(message?: string) {
		new Notice('Değişiklikler kaydediliyor (commit)...');
		try {
			// Tüm dosyaları ekle (isomorphic-git'te add tümünü kapsar)
            const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
            await Promise.all(
                status.map(([filepath, ...statuses]) => {
                    if (statuses.some(s => s !== 0)) { // 0 = unmodified
                       return git.add({ fs: this.fs, dir: this.dir, filepath });
                    }
                })
            );
            
            // Eğer eklenecek bir şey yoksa commit atma
            const freshStatus = await git.statusMatrix({ fs: this.fs, dir: this.dir });
            if (freshStatus.every(([filepath, head, workdir, stage]) => head === 1 && workdir === 1 && stage === 1)) {
                 new Notice('Kaydedilecek yeni değişiklik bulunmuyor.');
                 return;
            }

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
			console.error(e);
			new Notice(`Commit hatası: ${e.message}`, 10000);
		}
	}

	async gitPush() {
		new Notice('Değişiklikler uzak depoya gönderiliyor (push)...');
		try {
			const result = await git.push({
				fs: this.fs,
				http,
				dir: this.dir,
				onAuth: () => ({ username: this.settings.pat }),
			});
			if (result.ok) {
				new Notice('Değişiklikler başarıyla gönderildi!');
			} else {
				throw new Error(result.errors.join('\n'));
			}
		} catch (e) {
			console.error(e);
			new Notice(`Push hatası: ${e.message}`, 10000);
		}
	}

	async gitPull() {
		new Notice('Değişiklikler çekiliyor (pull)...');
		try {
			await git.pull({
				fs: this.fs,
				http,
				dir: this.dir,
				ref: this.settings.branchName,
				singleBranch: true,
				author: { name: this.settings.authorName, email: this.settings.authorEmail },
				onAuth: () => ({ username: this.settings.pat }),
			});
			new Notice('Değişiklikler başarıyla çekildi ve birleştirildi!');
		} catch (e) {
			console.error(e);
			new Notice(`Pull hatası: ${e.message}`, 10000);
		}
	}

	onunload() {
		console.log('Git Mobil eklentisi kaldırılıyor...');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
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
		containerEl.createEl('h2', { text: 'Git Mobil Ayarları' });

		// --- Bağlantı Ayarları ---
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

		// --- Operasyonel Ayarlar ---
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
        
        // --- Durum ve Eylemler ---
        containerEl.createEl('h3', { text: 'Durum ve Eylemler' });
        const statusEl = containerEl.createEl("div");
        this.renderStatusAndActions(statusEl);
	}

    async renderStatusAndActions(containerEl: HTMLElement) {
        containerEl.empty();
        
        let gitRepoExists = false;
        try {
            // @ts-ignore
            gitRepoExists = await this.plugin.fs.stat(this.plugin.dir + '/.git') !== undefined;
        } catch (e) {
            // Stat hata verirse dosya yoktur.
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
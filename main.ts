
import { link } from 'fs';
import { TFile, getLinkpath } from 'obsidian';
import { FileManager, MarkdownView, Plugin, } from 'obsidian';
import { getAPI } from 'obsidian-dataview';



export default class MasterBoard extends Plugin {

	async onload() {
	
		
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		
		if(!view?.file) return;

		let masterBoardFile = this.app.vault.getAbstractFileByPath(view.file.path);

		if(!(masterBoardFile instanceof TFile)) return;

		//let matter = await this.app.fileManager.processFrontMatter(file, (matter) => console.log(matter));
		const cache = this.app.metadataCache.getFileCache(masterBoardFile);
		
		cache?.frontmatterLinks?.forEach(async (fml) => {
			let linkPath = getLinkpath(fml.link);
			//console.log(linkPath);

			let sourceTFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, masterBoardFile!.path);
			if(!(sourceTFile instanceof TFile)) return;

			let sourceBoardMetadata = this.app.metadataCache.getFileCache(sourceTFile!);
			console.log(sourceBoardMetadata?.headings);

			this.app.vault.cachedRead(sourceTFile).then((val)=> console.log(val.split('\n')));


		});

		// console.log(view?.editor.getValue());
		// Grab tasks from linked pages
	// 	const api = getAPI();
	// 	console.log("pages:")
	// console.log(api.pages()[0].file.tasks);

	}
}

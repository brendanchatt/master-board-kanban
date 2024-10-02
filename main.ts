
import { TFile } from 'obsidian';
import { FileManager, MarkdownView, Plugin, } from 'obsidian';
import { getAPI } from 'obsidian-dataview';



export default class MasterBoard extends Plugin {

	async onload() {
	
		
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		
		if(!view?.file) return;

		let file = this.app.vault.getAbstractFileByPath(view.file.path);

		if(!(file instanceof TFile)) return;

		let matter = await this.app.fileManager.processFrontMatter(file, (matter) => console.log(matter));
		const cache = this.app.metadataCache.getFileCache(file);
		let links = cache?.links;
		console.log(cache?.frontmatterLinks);

		// const path = this.app.metadataCache.getFirstLinkpathDest( getLinkpath('goin Down.mpr' ), 'Goin Down.mp3' )
		// 	const url = this.app.vault.getResourcePath( path )
		//console.log(links);
		// console.log(view?.editor.getValue());
		// Grab tasks from linked pages
		// const api = getAPI();
		// console.log("pages:")
		// console.log(api.pagesByLinkOrSomething()[0].file.tasks);

	}
}

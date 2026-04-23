import { Editor } from "./editor";

export interface Header {
    level: number;
    text: string;
    line: number;
}

export class OutlineView {
    private container: HTMLElement;
    private editor: Editor;

    constructor(container: HTMLElement, editor: Editor) {
        this.container = container;
        this.editor = editor;
        this.init();
    }

    private init() {
        this.container.classList.add('outline-view');
        this.render();

        this.editor.onContentChange(() => {
            this.render();
        });
    }

    private render() {
        const headers = this.editor.getHeaders();
        this.container.innerHTML = '';
        
        const title = document.createElement('div');
        title.className = 'outline-title';
        title.innerText = '目录大纲';
        this.container.appendChild(title);

        const list = document.createElement('div');
        list.className = 'outline-list';

        headers.forEach(header => {
            const item = document.createElement('div');
            item.className = `outline-item level-${header.level}`;
            item.innerText = header.text;
            item.onclick = () => {
                this.editor.jumpToLine(header.line);
            };
            list.appendChild(item);
        });

        this.container.appendChild(list);
    }
}

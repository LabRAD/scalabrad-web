import {RegistryApi, RegistryListing} from '../scripts/registry';
import {Places} from '../scripts/places';

type ListItem = {
  name: string,
  isParent: boolean,
  isDir: boolean,
  isKey: boolean,
  url?: string,
  value?: string,
};

@component('labrad-registry')
export class LabradRegistry extends polymer.Base {

  @property({type: Array, notify: true, value: () => []})
  dirs: {name: string; url: string}[];

  @property({type: Array, notify: true, value: () => []})
  keys: {name: string; value: string}[];

  @property({type: Array, notify: true, value: () => []})
  path: string[];

  @property({type: Array, value: () => []})
  filteredListItems: ListItem[];

  @property({type: Array, value: () => []})
  private listItems: ListItem[];

  @property({type: Object, notify: true, value: () => {}})
  selected: ListItem;

  @property({type: Object})
  socket: RegistryApi;

  @property()
  places: Places;

  @property({type: String, notify: true})
  notify: string;

  @property({type: String, notify: true, value: ''})
  filterText: string;

  regex: RegExp; //regular expression for string comparison

  target: HTMLElement = document.body;

  private dialogs: string[] = [
    'newKeyDialog',
    'editValueDialog',
    'newFolderDialog',
    'dragDialog',
    'copyDialog',
    'renameDialog',
    'deleteDialog',
    'pendingDialog',
  ];

  attached() {
    this.bindIronAutogrowTextAreaResizeEvents(this.$.newKeyDialog,
                                              this.$.newValueInput);

    this.bindIronAutogrowTextAreaResizeEvents(this.$.editValueDialog,
                                              this.$.editValueInput);
  }


  private getListOffset(): number {
    return this.path.length > 0 ? 1 : 0;
  }


  private getDefaultSelectedItem(): number {
    return this.getListOffset();
  }


  private getSelectedIndex(): number {
    const index = this.listItems.indexOf(this.selected);
    if (index === -1) {
      return null;
    }
    return index;
  }


  private scrollToIndex(index: number): void {
    const list = this.$.combinedList;
    const first = list.firstVisibleIndex;
    const last = list.lastVisibleIndex;

    if (index < first) {
      list.scrollToIndex(index);
    } else if (index > last) {
      list.scrollToIndex(index - (last - first));
    }
  }


  private getOpenDialog() {
    for (const dialog of this.dialogs) {
      if (this.$[dialog].opened) {
        return this.$[dialog];
      }
    }
    return null;
  }


  cursorMove(event) {
    if (this.getOpenDialog()) {
      return;
    }

    this.searchSubmit();
    event.detail.keyboardEvent.preventDefault();

    const length = this.listItems.length;
    const selectedIndex = this.getSelectedIndex();
    const list = this.$.combinedList;

    switch (event.detail.combo) {
      case 'up':
        if (selectedIndex !== null && selectedIndex !== 0) {
          list.selectItem(selectedIndex - 1);
          this.scrollToIndex(selectedIndex - 1);
        }
        break;

      case 'down':
        if (selectedIndex === null) {
          list.selectItem(0);
          this.scrollToIndex(0);
        } else if (selectedIndex < length - 1) {
          list.selectItem(selectedIndex + 1);
          this.scrollToIndex(selectedIndex + 1);
        }
        break;

      default:
        // Nothing to do.
        break;
    }
  }


  cursorTraverse(event) {
    if (this.getSelectedIndex() === null || this.getOpenDialog() || this.$.search.focused) {
      return;
    }

    const item = this.$.combinedList.selectedItem;

    // If we have an item, we want to traverse down.
    if (!item) {
      return;
    }

    // If we have a link, we want to traverse down.
    if (item.url) {
      this.fire('app-link-click', {path: item.url});
    } else {
      this.editValueSelected();
    }
  }


  cursorBack(event) {
    if (this.path.length === 0 || this.getOpenDialog() || this.$.search.focused) {
      return;
    }

    const parentPath = this.path.slice(0, -1);
    const parentUrl = this.places.registryUrl(parentPath);
    this.fire('app-link-click', {path: parentUrl});
  }


  searchSubmit() {
    if (this.$.search.focused) {
      this.$.search.inputElement.blur();
    }
  }


  dialogSubmit(event) {
    const dialog = this.getOpenDialog();
    if (!dialog) {
      return;
    }

    event.detail.keyboardEvent.preventDefault();

    switch (dialog.id) {
      case 'newKeyDialog':
        this.doNewKey();
        break;

      case 'newFolderDialog':
        this.doNewFolder();
        break;

      case 'editValueDialog':
        this.doEditValue();
        break;

      case 'renameDialog':
        this.doRename();
        break;

      case 'copyDialog':
        this.doCopy();
        break;

      default:
        // Nothing to do.
        break;
    }

    dialog.close();
  }


  dialogCancel(event) {
    const dialog = this.getOpenDialog();
    if (!dialog) {
      return;
    }
    event.detail.keyboardEvent.preventDefault();
    dialog.close();
  }


  /**
   * On path change, select the default element and clear the filter.
   */
  @observe('path')
  pathChanged(newPath: string[], oldPath: string[]) {
    this.set('filterText', '');
  }

  /**
   * triggers re-render of dir, key lists when filterText is changed
   */
  @observe('filterText')
  reloadMenu() {
    if (!this.listItems) {
      return;
    }

    this.regex = new RegExp(this.filterText, 'i');
    this.set('filteredListItems', this.listItems.filter((item) => {
      return (!!item.name.match(this.regex));
    }));
    if (this.filteredListItems.length) {
      this.$.combinedList.selectItem(0);
    }
  }


  private getSelectedType(): string {
    // Account for parent '..' entry.
    const offset = this.getListOffset();
    if (this.dirs && this.getSelectedIndex() < this.dirs.length + offset) {
      return 'dir';
    } else {
      return 'key';
    }
  }


  async repopulateList(): Promise<void> {
    const resp = await this.socket.dir({path: this.path});

    this.splice('dirs', 0, this.dirs.length);
    this.splice('keys', 0, this.keys.length);
    this.splice('listItems', 0, this.listItems.length);

    if (this.path.length > 0 && this.places) {
      const url = this.places.registryUrl(this.path.slice(0, -1));
      this.push('listItems', {
        name: '..',
        isParent: true,
        isDir: false,
        isKey: false,
        url: url
      });
    }

    for (const name of resp.dirs) {
      const url = this.places.registryUrl(resp.path, name);
      this.push('dirs', {
        name: name,
        url: url,
      });
      this.push('listItems', {
        name: name,
        isParent: false,
        isDir: true,
        isKey: false,
        url: url
      });
    }

    for (const j in resp.keys) {
      const name = resp.keys[j];
      const value = resp.vals[j];
      this.push('keys', {
        name: name,
        value: value,
      });

      this.push('listItems', {
        name: name,
        isParent: false,
        isDir: false,
        isKey: true,
        value: value
      });
    }

    this.set('filteredListItems', this.listItems);
    this.$.combinedList.selectItem(this.getDefaultSelectedItem());
    this.$.pendingDialog.close()
  }


  pathToString(path) {
    return JSON.stringify(path);
  }


  computeSelectedClass(selected: ListItem): string {
    return (selected) ? "iron-selected" : "";
  }


  handleError(error) {
    // We can add a more creative way of displaying errors here.
    console.error(error);
  }


  /**
   * Update a key in response to change in the inline form submission.
   */
  @listen('iron-form-submit')
  async updateKey(event) {
    var selKey = event.detail.key;
    var newVal = event.detail.value;
    try {
      await this.socket.set({path: this.path, key: selKey, value: newVal});
      this.repopulateList();
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Drag and drop logic
   */
  @listen('dragenter')
  onDragEnter(event) {
    event.preventDefault(); //I don't understand this.
  }

  @listen('dragleave')
  onDragLeave(event) {
    event.preventDefault(); //I don't understand this. But it needs to be here
  }

  /**
   * allows the ctrl key to be pressed to change cursor between copy/move
   */
  @listen('dragover')
  onDragOver(event) {
    event.preventDefault(); //I don't understand this. But needs to be here
    if (event.ctrlKey) {
      event.dataTransfer.dropEffect = "copy";
    }
    else {
      event.dataTransfer.dropEffect = "move";
    }
  }

  @listen('dragstart')
  startDrag(event) {
    //detect start of drag event, grab info about target
    var data: any; //I tried enum, but kept getting errors...
    data = {path: this.path, name: event.target.name, kind: event.target.className.split(' ')[0]};
    event.dataTransfer.setData('text', JSON.stringify(data));
    event.dataTransfer.effectAllowed = 'copyMove';
  }

  onDirDragOver(event) {
    event.currentTarget.classList.add('over');
  }

  onDirDragLeave(event) {
    event.currentTarget.classList.remove('over');
  }

  @listen('dragend')
  endDrag(event) {
  }

  /**
   * behaviour for dropping on folders
   */
  dirDrop(event) {
    event.stopPropagation();
    var data = JSON.parse(event.dataTransfer.getData('text'));
    this.$.dragDialog.dragData = data;
    var newPath: string[] = this.path.slice();
    newPath.push(event.target.closest('td').name);
    event.target.closest('td').classList.remove('over');
    this.$.dragNameInput.value = data.name;
    this.$.dragClass.textContent = data.kind;
    this.$.originName.textContent = data.name;
    this.$.originPath.textContent = JSON.stringify(data.path);
    this.$.dragPathInput.value = this.pathToString(newPath);

    if (event.ctrlKey || event.button == 2 ) {
      //should I use switch and case here instead of ifs?
      this.$.dragOp.innerText = 'Copy';
      this.$.dragDialog.open();
      setTimeout(() => this.$.dragPathInput.$.input.focus(), 0);
    } else {
      this.$.dragOp.innerText = 'Move';
      this.$.dragDialog.open();
      setTimeout(() => this.$.dragPathInput.$.input.focus(), 0);
    }

  }

  /**
   * handles folders dropped not into folders
   */
  @listen('drop')
  handleDrop(event) {
    event.preventDefault();
    var data = JSON.parse(event.dataTransfer.getData('text'));
    this.$.dragDialog.dragData = data;
    event.target.closest('td').classList.remove('over');
    this.$.dragNameInput.value = data.name;
    this.$.dragClass.textContent = data.kind;
    this.$.originName.textContent = data.name;
    this.$.originPath.textContent = JSON.stringify(data.path);
    this.$.dragPathInput.value = this.pathToString(this.path);

    if (event.ctrlKey) {
      this.$.dragOp.innerText = 'Copy';
      this.$.dragDialog.open();
      setTimeout(() => this.$.dragPathInput.$.input.focus(), 0);
    } else if(JSON.stringify(this.path) != JSON.stringify(data.path)) {
      this.$.dragOp.innerText = 'Move';
      this.$.dragDialog.open();
      setTimeout(() => this.$.dragPathInput.$.input.focus(), 0);
    }
  }

  /**
   * Bind event listeners to resize dialog box appropriately when an
   * `iron-autogrow-textarea` is used.
   *
   * This works around an issue where it does not fire an `iron-resize` event
   * when the value updates, and hence a `paper-dialog` is not informed to
   * update its size or position to accomodate the change in content size.
   */
  bindIronAutogrowTextAreaResizeEvents(paperDialog: HTMLElement,
                                       ironAutogrowTextarea: HTMLElement) {
    ironAutogrowTextarea.addEventListener('bind-value-changed', () => {
      Polymer.Base.fire("iron-resize", null, {node: ironAutogrowTextarea});
    });
  }

  /**
   * Launch new key dialog.
   */
  newKeyClicked(event) {
    var dialog = this.$.newKeyDialog,
        newKeyElem = this.$.newKeyInput,
        newValueElem = this.$.newValueInput;
    newKeyElem.value = '';
    newValueElem.value = '';
    dialog.open();
  }

  /**
   * Create new key.
   */
  async doNewKey() {
    var newKey = this.$.newKeyInput.value;
    var newVal = this.$.newValueInput.value;

    if (newKey) {
      try {
        await this.socket.set({path: this.path, key: newKey, value: newVal});
        this.repopulateList();
      } catch (error) {
        this.handleError(error);
      }
    }
    else {
      this.handleError('Cannot create key with empty name');
    }
  }


  private editValueSelected() {
    const item = this.$.combinedList.selectedItem;
    const dialog = this.$.editValueDialog;
    const editValueElem = this.$.editValueInput;

    editValueElem.value = item.keyValue;
    dialog.keyName = item.keyName;
    dialog.open();
  }


  /**
   * Launch the value edit dialog.
   */
  editValueClicked(event) {
    var dialog = this.$.editValueDialog,
        editValueElem = this.$.editValueInput,
        name = event.currentTarget.keyName,
        isKey = event.currentTarget.isKey,
        value: string = null,
        found = false;
    if (!isKey) return;
    for (let item of this.keys) {
      if (item.name == name) {
        value = item.value;
        found = true;
        break;
      }
    }
    if (!found) {
      return;
    }
    editValueElem.value = value;
    dialog.keyName = name;
    dialog.open();
  }


  /**
   * Submit the edited value to the server.
   */
  async doEditValue() {
    var key = this.$.editValueDialog.keyName,
        newVal = this.$.editValueInput.value;
    try {
      await this.socket.set({path: this.path, key: key, value: newVal});
      this.repopulateList();
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Launch new folder dialog.
   */
  newFolderClicked() {
    var dialog = this.$.newFolderDialog,
        newFolderElem = this.$.newFolderInput;
    newFolderElem.value = '';
    dialog.open();
  }

  /**
   * Create new folder.
   */
  async doNewFolder() {
    var newFolder = this.$.newFolderInput.value;

    if (newFolder) {
      try {
        await this.socket.mkDir({path: this.path, dir: newFolder})
        this.repopulateList();
      } catch (error) {
        this.handleError(error);
      }
    }
    else {
      this.handleError('Cannot create folder with empty name');
    }
  }


  /**
   * Launch copy dialog.
   */
  copyClicked() {
    var dialog = this.$.copyDialog,
        copyNameElem = this.$.copyNameInput,
        copyPathElem = this.$.copyPathInput;
    copyNameElem.value = this.$.combinedList.selectedItem;
    copyPathElem.value = this.pathToString(this.path);
    dialog.open();
  }

  /**
   * Copy the selected key or folder.
   */
  async doCopy() {
    var newName =  this.$.copyNameInput.value;
    var newPath = JSON.parse(this.$.copyPathInput.value);

    const selectedType = this.getSelectedType();

    try {
      if (selectedType === 'dir') {
        this.$.pendingDialog.open();
        this.$.pendingOp.innerText = "Copying...";
        await this.socket.copyDir({path: this.path, dir: this.$.combinedList.selectedItem, newPath: newPath, newDir: newName});
      }
      else if (selectedType === 'key') {
        await this.socket.copy({path: this.path, key: this.$.combinedList.selectedItem, newPath: newPath, newKey: newName});
      }
      this.repopulateList();
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Execute the drag operation
   */
  async doDragOp() {
    var newName =  this.$.dragNameInput.value;
    var newPath = JSON.parse(this.$.dragPathInput.value);
    var oldPath = JSON.parse(this.$.originPath.textContent);
    var oldName = this.$.originName.textContent;

    if (this.$.dragOp.innerText === 'Copy') {
      try {
        this.$.pendingDialog.open();
        this.$.pendingOp.innerText = "Copying...";
        switch (this.$.dragDialog.dragData['kind']) {
          case "dir":
            var resp = await this.socket.copyDir({path: oldPath, dir: oldName, newPath: newPath, newDir: newName});
            break;

          case "key":
            var resp = await this.socket.copy({path: oldPath, key: oldName, newPath: newPath, newKey: newName});
            break;
        }
      } catch (error) {
        this.handleError(error);
      } finally {
        this.$.pendingDialog.close();
        this.$.toastCopySuccess.show();
      }
    }
    else if (this.$.dragOp.innerText === 'Move') {
      try {
        this.$.pendingDialog.open();
        this.$.pendingOp.innerText = "Moving...";
        switch (this.$.dragDialog.dragData['kind']) {
          case "dir":
            var resp = await this.socket.moveDir({path: oldPath, dir: oldName, newPath: newPath, newDir: newName});
            break;

          case "key":
            var resp = await this.socket.move({path: oldPath, key: oldName, newPath: newPath, newKey: newName});
            break;
        }
      } catch (error) {
        this.handleError(error);
      } finally {
        this.$.pendingDialog.close();
        this.$.toastMoveSuccess.show();
      }
    }
  }


  /**
   * Launch rename dialog.
   */
  renameClicked() {
    var dialog = this.$.renameDialog,
        renameElem = this.$.renameInput;

    var name = this.$.combinedList.selectedItem;

    renameElem.value = name;
    dialog.open();
  }

  /**
   * Rename the selected key or folder.
   */
  async doRename() {
    //TODO add pending modal dialog for renames since they are copy commands and take a long time
    var newName = this.$.renameInput.value;

    var name = this.$.combinedList.selectedItem;

    if (newName === null || newName === name) return;

    const selectedType = this.getSelectedType();

    if (newName) {
      try {
        if (selectedType === 'dir') {
          await this.socket.renameDir({path: this.path, dir: name, newDir: newName});
        }
        else if (selectedType === 'key') {
          await this.socket.rename({path: this.path, key: name, newKey: newName});
        }
        this.repopulateList();
      } catch (error) {
        this.handleError(error);
      }
    }
    else {
      this.handleError(`Cannot rename ${selectedType} to empty string`);
    }
  }

  /**
   * Launch the delete confirmation dialog.
   */
  deleteClicked() {
    this.$.deleteDialog.open();
  }

  /**
   * Delete the selected key or folder.
   */
  async doDelete() {
    try {
      const selectedType = this.getSelectedType();
      if (selectedType === 'dir') {
        this.$.pendingDialog.open();
        this.$.pendingOp.innerText = "Deleting...";
        await this.socket.rmDir({path: this.path, dir: this.$.combinedList.selectedItem});
      }
      else if (selectedType === 'key') {
        await this.socket.del({path: this.path, key: this.$.combinedList.selectedItem});
      }
      this.repopulateList();
    } catch (error) {
      this.handleError(error);
    }
  }
}

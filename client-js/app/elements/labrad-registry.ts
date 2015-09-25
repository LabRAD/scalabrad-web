import {RegistryApi, RegistryListing} from '../scripts/registry';

@component('labrad-registry')
export class LabradRegistry extends polymer.Base {

  @property({type: Array, notify: true})
  dirs: Array<any>;

  @property({type: Array, notify: true})
  keys: Array<any>;

  @property({type: Array, notify: true})
  path: Array<string>;

  @property({type: Object})
  socket: RegistryApi;

  @property({type: String, notify: true})
  notify: string;

  @property({type: String, notify: true, value: null})
  selDir: string;

  @property({type: String, notify: true, value: null})
  selKey: string;

  @property({type: String, notify: true, value: null})
  selectType: string;
    
  @property({type: String, notify: true, value: ''})
  filterText: string;
  
  regex: RegExp; //regular expression for string comparison

  //Helper Functions
  @observe('path')
  pathChanged(newPath: string[], oldPath: string[]) {
    // on a path change, we deselect everything, empty filterText
    this.selDir = null;
    this.selKey = null;
    this.selectType = null;
    this.filterText = '';
  }

  @observe('filterText')
  reloadMenu() {
    //triggers re-render of dir, key lists when filterText is changed
    this.regex = new RegExp(this.filterText, 'i');
    this.$.dirList.render();
    this.$.keyList.render();


  }

  filterFunc(item) {
    // called when dir, key lists are populated. Returns entries that contain
    // substring in filterText
    return item.name.match(this.regex);
  }

  selectKey() {
    this.selDir = null;
    this.selectType = 'key';
  }

  selectDir() {
    this.selKey = null;
    this.selectType = 'dir';
  }

  @computed()
  selected(selectType: string, selDir: string, selKey: string): boolean {
    console.log('selectType', selectType, 'selDir', selDir, 'selKey', selKey);
    return (selectType === 'dir' && selDir != null) || (selectType === 'key' && selKey != null);
  }

  incrementSelector() {
    console.log(this.selKey);
    //TODO increment selected key on tab
  }

  repopulateList(resp: RegistryListing) {
    this.selDir = null;
    this.splice('dirs', 0, this.dirs.length);
    this.splice('keys', 0, this.keys.length);

    for (var i in resp.dirs) {
      this.push('dirs', {name: resp.dirs[i], url: this.createUrl(resp.path, resp.dirs[i])});
    }
    for (var j in resp.keys) {
      this.push('keys', {name: resp.keys[j], value: resp.vals[j]});
    }
  }

  createUrl(path: Array<string>, dir: string): string {
    var pathUrl = '/registry/';
    if (path.length === 0) {
      return pathUrl + dir;
    }//not sure if this is the best way to handle this edge case
    for (var i in path) {
      pathUrl += path[i] + '/';
    }
    console.log(pathUrl + dir);
    return pathUrl + dir;
  }

  pathToString(path) {
    return JSON.stringify(path);
  }

  handleError(error) {
    //we can add a more creative way of displaying errors here
    console.log(error);
  }


  /**
   * Update a key in response to change in the inline form submission.
   */
  @listen('iron-form-submit')
  updateKey(event) {
    var self = this;
    var selKey = event.detail.key;
    var newVal = event.detail.value;
    this.socket.set({path: this.path, key: selKey, value: newVal}).then(
      (resp) => {
        self.repopulateList(resp);
        self.selKey = null;
      },
      (reason) => self.handleError(reason)
    );
  }


  /**
   * Launch new key dialog.
   */
convertToXML(params: {path: Array<string>, name: string, xml: Object}): Promise<Object>;

  @listen('dragstart')
  startDragging(event) {
    var path = this.path.slice(0);
    
    console.log('dragstart', event.target.name, path);
    var XML = document.createElement("dir");
    this.convertToXML(path, event.target.name, XML).then(
    (result) => event.dataTransfer.setData("text/plain",new XMLSerializer().serializeToString(result) )
        );
    //evedataTransfer.setData("text/plain", );
    //console.log("done",XML);
    
      
//       var XML2 = document.createElement("dir");
//      var Node = document.createElement("testing");
//Node.appendChild( document.createElement("testingOne") );
//Node.appendChild( document.createElement("TestingTwo") );
//Node.appendChild( document.createElement("TestingThree") );
//XML2.appendChild(Node);
//
//alert(XML2.innerHTML);
//    alert(XML.innerHTML);
      //(new XMLSerializer()).serializeToString(XML)
  }

  convertToXML(path, name, XML) {
    path.push(name);
    console.log(path);
    var Node = document.createElement(name);
    
    this.socket.dir({path: path}).then(
        (resp) => this.handleResp(resp, path, Node)
        );
    
    XML.appendChild(Node);
    return XML;
  }
    
  handleResp(resp, path, Node) {
      console.log(resp);
      var key;
      var name:
      val: string;
    for (var i in resp.keys) {
      key = Node.appendChild( document.createElement( "key" ));
      name = key.appendChild( document.createElement( "name" ));
      val = key.appendChild( document.createElement( "value" ));
      name.appendChild( document.createTextNode( resp.keys[i] )); //;
      val.appendChild( document.createTextNode( resp.vals[i] )); //;
     // Node.appendChild( document.createElement(resp.keys[i]));
     // Node.appendChile( document.setAttribute(resp.keys[i], resp.vals[i]));
    }
    for (var j in resp.dirs) {
      //console.log(path, resp.dirs[i]);
      //Node.appendChild( document.createElement( resp.dirs[j] ));
      this.convertToXML(path, resp.dirs[j], Node);
    }
  }

   
    
//  reallyConvertToXML(resp, path) {
//      console.log(resp);
//      var path: Array;
//      
//      crawl(XML,resp,path);
//  }
//  crawl(XML, resp, path) {
//      for (var i in resp.dirs) {
//        console.log(resp.dirs[i]);
//        var Node = document.createElement(resp.dirs[i]);
//        path.push(resp.dirs[i]);
//        this.socket.dir({path: path}).then(
//        (resp) => this.reallyConvertToXML(resp)
//        );
//      }
//      XML.appendChild(Node);
//  }
  newKeyClicked(event) {
    var dialog = this.$.newKeyDialog,
        newKeyElem = this.$.newKeyInput,
        newValueElem = this.$.newValueInput;
    newKeyElem.value = '';
    newValueElem.value = '';
    dialog.open();
    window.setTimeout(() => newKeyElem.$.input.focus(), 0);
  }

  /**
   * Create new key.
   */
  doNewKey() {
    var self = this;
    var newKey = this.$.newKeyInput.value;
    var newVal = this.$.newValueInput.value;

    if (newKey) {
      this.socket.set({path: this.path, key: newKey, value: newVal}).then(
        (resp) => self.repopulateList(resp),
        (reason) => self.handleError(reason)
      );
    }
    else {
      this.handleError('Cannot create key with empty name');
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
    window.setTimeout(() => newFolderElem.$.input.focus(), 0);
  }

  /**
   * Create new folder.
   */
  doNewFolder() {
    var self = this,
        newFolder = this.$.newFolderInput.value;

    if (newFolder) {
      this.socket.mkDir({path: this.path, dir: newFolder}).then(
        (resp) => self.repopulateList(resp),
        (reason) => self.handleError(reason)
      );
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
    copyNameElem.value = this.selDir || this.selKey;
    copyPathElem.value = this.pathToString(this.path);
    dialog.open();
    window.setTimeout(() => copyNameElem.$.input.focus(), 0);
  }

  /**
   * Copy the selected key or folder.
   */
  doCopy() {
    var self = this;
    var newName =  this.$.copyNameInput.value;
    var newPath = JSON.parse(this.$.copyPathInput.value);

    if (this.selectType === 'dir') {
      this.socket.copyDir({path: this.path, dir: this.selDir, newPath: newPath, newDir: newName}).then(
        (resp) => self.repopulateList(resp),
        (reason) => self.handleError(reason)
      );
    }
    else if (this.selectType === 'key') {
      this.socket.copy({path: this.path, key: this.selKey, newPath: newPath, newKey: newName}).then(
        (resp) => self.repopulateList(resp),
        (reason) => self.handleError(reason)
      );
    }
  }


  /**
   * Launch rename dialog.
   */
  renameClicked() {
    var dialog = this.$.renameDialog,
        renameElem = this.$.renameInput;

    var name: string;
    switch (this.selectType) {
      case 'dir': name = this.selDir; break;
      case 'key': name = this.selKey; break;
      default: return;
    }

    renameElem.value = name;
    dialog.open();
    window.setTimeout(() => renameElem.$.input.focus(), 0);
  }

  /**
   * Rename the selected key or folder.
   */
  doRename() {
    var self = this,
        newName = this.$.renameInput.value;

    var name: string;
    switch (this.selectType) {
      case 'dir': name = this.selDir; break;
      case 'key': name = this.selKey; break;
      default: return;
    }

    if (newName === null || newName === name) return;
    if (newName) {
      if (this.selectType === 'dir') {
        this.socket.renameDir({path: this.path, dir: name, newDir: newName}).then(
          (resp) => self.repopulateList(resp),
          (reason) => self.handleError(reason)
        );
      }
      else if (this.selectType === 'key') {
        this.socket.rename({path: this.path, key: name, newKey: newName}).then(
          (resp) => self.repopulateList(resp),
          (reason) => self.handleError(reason)
        );
      }
    }
    else {
      this.handleError(`Cannot rename ${this.selectType} to empty string`);
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
  doDelete() {
    var self = this;

    if (this.selectType === 'dir') {
      this.socket.rmDir({path: this.path, dir: this.selDir}).then(
        (resp) => self.repopulateList(resp),
        (reason) => self.handleError(reason)
      );
    }
    else if (this.selectType === 'key') {
      this.socket.del({path: this.path, key: this.selKey}).then(
        (resp) => self.repopulateList(resp),
        (reason) => self.handleError(reason)
      );
    }
  }
}

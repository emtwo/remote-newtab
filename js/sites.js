/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This class represents a site that is contained in a cell and can be pinned,
 * moved around or deleted.
 */
function Site(aNode, aLink) {
  this._node = aNode;
  this._node._newtabSite = this;

  this._link = aLink;

  this._render();
  this._addEventHandlers();
}

Site.prototype = {
  /**
   * The site's DOM node.
   */
  get node() { return this._node; },

  /**
   * The site's link.
   */
  get link() { return this._link; },

  /**
   * The url of the site's link.
   */
  get url() { return this.link.url; },

  /**
   * The title of the site's link.
   */
  get title() { return this.link.title || this.link.url; },

  /**
   * The site's parent cell.
   */
  get cell() {
    let parentNode = this.node.parentNode;
    return parentNode && parentNode._newtabCell;
  },

  /**
   * Pins the site on its current or a given index.
   * @param aIndex The pinned index (optional).
   */
  pin: function Site_pin(aIndex) {
    if (typeof aIndex == "undefined")
      aIndex = this.cell.index;

    gNewTab.sendToBrowser("NewTab:PinLink", {link: this._link, index: aIndex});
    this._updateAttributes(true);
  },

  /**
   * Unpins the site.
   */
  unpin: function Site_unpin() {
    if (this.isPinned()) {
      gNewTab.sendToBrowser("NewTab:UnpinLink", {link: this._link});
      this._updateAttributes(false);
    }
  },

  /**
   * Checks whether this site is pinned.
   * @return Whether this site is pinned.
   */
  isPinned: function Site_isPinned() {
    return this._link.pinState;
  },

  /**
   * Blocks the site (removes it from the grid) and calls the given callback
   * when done.
   */
  block: function Site_block() {
    if (!this.isBlocked()) {
      gUndoDialog.show(this);
      gNewTab.sendToBrowser("NewTab:BlockLink", {link: this._link});
    }
  },

  /**
   * Checks whether this site is blocked.
   * @return Whether this site is blocked.
   */
  isBlocked: function Site_isBlocked() {
    return this._link.blockState;
  },

  /**
   * Gets the DOM node specified by the given query selector.
   * @param aSelector The query selector.
   * @return The DOM node we found.
   */
  _querySelector: function Site_querySelector(aSelector) {
    return this.node.querySelector(aSelector);
  },

  /**
   * Updates attributes for all nodes which status depends on this site being
   * pinned or unpinned.
   * @param aPinned Whether this site is now pinned or unpinned.
   */
  _updateAttributes: function (aPinned) {
    let control = this._querySelector(".newtab-control-pin");

    if (aPinned) {
      this.node.setAttribute("pinned", true);
      control.setAttribute("title", gNewTab.newTabString("unpin"));
    } else {
      this.node.removeAttribute("pinned");
      control.setAttribute("title", gNewTab.newTabString("pin"));
    }
  },

  _newTabString: function(str, substrArr) {
    let regExp = /%[0-9]\$S/g;
    let matches;
    while (matches = regExp.exec(str)) {
      let match = matches[0];
      let index = match.charAt(1); // Get the digit in the regExp.
      str = str.replace(match, substrArr[index - 1]);
    }
    return str;
  },

  _getSuggestedTileExplanation: function() {
    let targetedName = `<strong> ${this.link.targetedName} </strong>`;
    let targetedSite = `<strong> ${this.link.targetedSite} </strong>`;
    if (this.link.explanation) {
      return this._newTabString(this.link.explanation, [targetedName, targetedSite]);
    }
    return gNewTab.newTabString("suggested.button", [targetedName]);
  },

  /**
   * Checks for and modifies link at campaign end time
   */
  _checkLinkEndTime: function Site_checkLinkEndTime() {
    if (this.link.endTime && this.link.endTime < Date.now()) {
       let oldUrl = this.url;
       // chop off the path part from url
       this.link.url = Services.io.newURI(this.url, null, null).resolve("/");
       // clear supplied images - this triggers thumbnail download for new url
       delete this.link.imageURI;
       delete this.link.enhancedImageURI;
       // remove endTime to avoid further time checks
       delete this.link.endTime;
       // clear enhanced-content image that may still exist in preloaded page
       this._querySelector(".enhanced-content").style.backgroundImage = "";
       gNewTab.sendToBrowser("NewTab:ReplacePinLink", {oldUrl, link: this.link});
    }
  },

  /**
   * Renders the site's data (fills the HTML fragment).
   */
  _render: function Site_render() {
    // first check for end time, as it may modify the link
    this._checkLinkEndTime();
    // setup display variables
    //let enhanced = Services.prefs.getBoolPref("browser.newtabpage.enhanced")
    //                && DirectoryLinksProvider.getEnhancedLink(this.link);
    let enhanced = gNewTab.enhanced;
    let url = this.url;
    let title = enhanced && enhanced.title ? enhanced.title :
                this.link.type == "history" ? this.link.baseDomain :
                this.title;
    let tooltip = (this.title == url ? this.title : this.title + "\n" + url);

    let link = this._querySelector(".newtab-link");
    link.setAttribute("title", tooltip);
    link.setAttribute("href", url);
    this._querySelector(".newtab-title").textContent = title;
    this.node.setAttribute("type", this.link.type);

    if (this.link.targetedSite) {
      if (this.node.getAttribute("type") != "sponsored") {
        this._querySelector(".newtab-sponsored").textContent =
          gNewTab.newTabString("suggested.tag");
      }

      this.node.setAttribute("suggested", true);
      let explanation = this._getSuggestedTileExplanation();
      this._querySelector(".newtab-suggested").innerHTML =
        `<div class='newtab-suggested-bounds'> ${explanation} </div>`;
    }

    if (this.isPinned())
      this._updateAttributes(true);
    // Capture the page if the thumbnail is missing, which will cause page.js
    // to be notified and call our refreshThumbnail() method.
    this.captureIfMissing();
    // but still display whatever thumbnail might be available now.
    this.refreshThumbnail();
  },

  /**
   * Called when the site's tab becomes visible for the first time.
   * Since the newtab may be preloaded long before it's displayed,
   * check for changed conditions and re-render if needed
   */
  onFirstVisible: function Site_onFirstVisible() {
    if (this.link.endTime && this.link.endTime < Date.now()) {
      // site needs to change landing url and background image
      this._render();
    }
    else {
      this.captureIfMissing();
    }
  },

  /**
   * Captures the site's thumbnail in the background, but only if there's no
   * existing thumbnail and the page allows background captures.
   */
  captureIfMissing: function Site_captureIfMissing() {
    if (!document.hidden && !this.link.imageURI) {
      gNewTab.sendToBrowser("NewTab:BackgroundPageThumbs", {url: this.url});
    }
  },

  /**
   * Refreshes the thumbnail for the site.
   */
  refreshThumbnail: function Site_refreshThumbnail() {
    gNewTab.sendToBrowser("NewTab:PageThumbs", {url: this.url});
  },

  _getURI: function Site_getURI(message) {
    // Only enhance tiles if that feature is turned on
    let link = /*message.enhanced && DirectoryLinksProvider.getEnhancedLink(this.link) || */this.link;

    let thumbnail = this._querySelector(".newtab-thumbnail");
    if (link.bgColor) {
      thumbnail.style.backgroundColor = link.bgColor;
    }

    let uri = this.link.imageURI || ("file://" + message.uri);
    thumbnail.style.backgroundImage = 'url("' + uri + '")';

    if (link.enhancedImageURI) {
      let enhanced = this._querySelector(".enhanced-content");
      enhanced.style.backgroundImage = 'url("' + link.enhancedImageURI + '")';

      if (this.link.type != link.type) {
        this.node.setAttribute("type", "enhanced");
        this.enhancedId = link.directoryId;
      }
    }
  },

  _ignoreHoverEvents: function(element) {
    element.addEventListener("mouseover", () => {
      this.cell.node.setAttribute("ignorehover", "true");
    });
    element.addEventListener("mouseout", () => {
      this.cell.node.removeAttribute("ignorehover");
    });
  },

  /**
   * Adds event handlers for the site and its buttons.
   */
  _addEventHandlers: function Site_addEventHandlers() {
    // Register drag-and-drop event handlers.
    this._node.addEventListener("dragstart", this, false);
    this._node.addEventListener("dragend", this, false);
    this._node.addEventListener("mouseover", this, false);

    gNewTab.registerListener("NewTab:"+ this.url +"URI", this._getURI.bind(this));

    // Specially treat the sponsored icon & suggested explanation
    // text to prevent regular hover effects
    let sponsored = this._querySelector(".newtab-sponsored");
    let suggested = this._querySelector(".newtab-suggested");
    this._ignoreHoverEvents(sponsored);
    this._ignoreHoverEvents(suggested);
  },

  _toggleLegalText: function(buttonClass, explanationTextClass) {
    let button = this._querySelector(buttonClass);
    if (button.hasAttribute("active")) {
      let explain = this._querySelector(explanationTextClass);
      explain.parentNode.removeChild(explain);

      button.removeAttribute("active");
    }
    else {
      let explain = document.createElementNS(HTML_NAMESPACE, "div");
      explain.className = explanationTextClass.slice(1); // Slice off the first character, '.'
      this.node.appendChild(explain);

      let link = '<a href="' + TILES_EXPLAIN_LINK + '">' +
                 gNewTab.newTabString("learn.link") + "</a>";
      let type = (this.node.getAttribute("suggested") && this.node.getAttribute("type") == "affiliate") ?
                  "suggested" : this.node.getAttribute("type");
      let icon = '<input type="button" class="newtab-control newtab-' +
                 (type == "enhanced" ? "customize" : "control-block") + '"/>';
      explain.innerHTML = gNewTab.newTabString(type + (type == "sponsored" ? ".explain2" : ".explain"), [icon, link]);

      button.setAttribute("active", "true");
    }
  },

  /**
   * Handles site click events.
   */
  onClick: function Site_onClick(aEvent) {
    let action;
    let pinned = this.isPinned();
    let tileIndex = this.cell.index;
    let {button, target} = aEvent;

    // Handle tile/thumbnail link click
    if (target.classList.contains("newtab-link") ||
        target.parentElement.classList.contains("newtab-link")) {
      // Record for primary and middle clicks
      if (button == 0 || button == 1) {
        gNewTab.sendToBrowser("NewTab:RecordSiteClicked", {index: tileIndex});
        action = "click";
      }
    }
    // Handle sponsored explanation link click
    else if (target.parentElement.classList.contains("sponsored-explain")) {
      action = "sponsored_link";
    }
    else if (target.parentElement.classList.contains("suggested-explain")) {
      action = "suggested_link";
    }
    // Only handle primary clicks for the remaining targets
    else if (button == 0) {
      aEvent.preventDefault();
      if (target.classList.contains("newtab-control-block")) {
        this.block();
        action = "block";
      }
      else if (target.classList.contains("sponsored-explain") ||
               target.classList.contains("newtab-sponsored")) {
        this._toggleLegalText(".newtab-sponsored", ".sponsored-explain");
        action = "sponsored";
      }
      else if (pinned && target.classList.contains("newtab-control-pin")) {
        this.unpin();
        action = "unpin";
      }
      else if (!pinned && target.classList.contains("newtab-control-pin")) {
        this.pin();
        action = "pin";
      }
    }

    // Report all link click actions
    if (action) {
      gNewTab.sendToBrowser("NewTab:ReportSitesAction", {sites: gNewTab.stringifySites(gGrid.sites), action: action, index: tileIndex});
    }
  },

  /**
   * Handles all site events.
   */
  handleEvent: function Site_handleEvent(aEvent) {
    switch (aEvent.type) {
      case "mouseover":
        this._node.removeEventListener("mouseover", this, false);
        gNewTab.sendToBrowser("NewTab:SpeculativeConnect", {url: this.url});
        break;
      case "dragstart":
        gDrag.start(this, aEvent);
        break;
      case "dragend":
        gDrag.end(this, aEvent);
        break;
    }
  }
};

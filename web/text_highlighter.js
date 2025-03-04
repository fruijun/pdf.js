/* Copyright 2021 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @typedef {Object} TextHighlighterOptions
 * @property {PDFFindController} findController
 * @property {EventBus} eventBus - The application event bus.
 * @property {number} pageIndex - The page index.
 */

/**
 * TextHighlighter handles highlighting matches from the FindController in
 * either the text layer or XFA layer depending on the type of document.
 */
class TextHighlighter {
  /**
   * @param {TextHighlighterOptions} options
   */
  constructor({ findController, eventBus, pageIndex }) {
    this.findController = findController;
    this.matches = [];
    this.eventBus = eventBus;
    this.pageIdx = pageIndex;
    this._onUpdateTextLayerMatches = null;
    this.textDivs = null;
    this.textContentItemsStr = null;
    this.enabled = false;
  }

  /**
   * Store two arrays that will map DOM nodes to text they should contain.
   * The arrays should be of equal length and the array element at each index
   * should correspond to the other. e.g.
   * `items[0] = "<span>Item 0</span>" and texts[0] = "Item 0";
   *
   * @param {Array<Node>} divs
   * @param {Array<string>} texts
   */
  setTextMapping(divs, texts) {
    this.textDivs = divs;
    this.textContentItemsStr = texts;
  }

  /**
   * Start listening for events to update the highlighter and check if there are
   * any current matches that need be highlighted.
   */
  enable() {
    if (!this.textDivs || !this.textContentItemsStr) {
      throw new Error("Text divs and strings have not been set.");
    }
    if (this.enabled) {
      throw new Error("TextHighlighter is already enabled.");
    }
    this.enabled = true;
    if (!this._onUpdateTextLayerMatches) {
      this._onUpdateTextLayerMatches = evt => {
        if (evt.pageIndex === this.pageIdx || evt.pageIndex === -1) {
          this._updateMatches();
        }
      };
      this.eventBus._on(
        "updatetextlayermatches",
        this._onUpdateTextLayerMatches
      );
    }
    this._updateMatches();
  }

  disable() {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;
    if (this._onUpdateTextLayerMatches) {
      this.eventBus._off(
        "updatetextlayermatches",
        this._onUpdateTextLayerMatches
      );
      this._onUpdateTextLayerMatches = null;
    }
  }

  _convertMatches(matches, matchesLength,matchesWithLength) {
    // Early exit if there is nothing to convert.
    if (!matches) {
      return [];
    }
    const { textContentItemsStr } = this;

    let i = 0,
      iIndex = 0;
    const end = textContentItemsStr.length - 1;
    const result = [];

    for (let m = 0, mm = matches.length; m < mm; m++) { 
      // Calculate the start position.
      let matchIdx = matches[m];

      // Loop over the divIdxs.
      while (i !== end && matchIdx >= iIndex + textContentItemsStr[i].length) {
        iIndex += textContentItemsStr[i].length;
        i++;
      }

      if (i === textContentItemsStr.length) {
        console.error("Could not find a matching mapping");
      }
      let item = matchesWithLength.find(d => d.match === matchIdx)
      const match = {
        begin: {
          divIdx: i,
          offset: matchIdx - iIndex,
          color:item.color
        },
        xId:item.x,
        text:item.text
      };

      // Calculate the end position.
      matchIdx += matchesLength[m];

      // Somewhat the same array as above, but use > instead of >= to get
      // the end position right.
      while (i !== end && matchIdx > iIndex + textContentItemsStr[i].length) {
        iIndex += textContentItemsStr[i].length;
        i++;
      }

      match.end = {
        divIdx: i,
        offset: matchIdx - iIndex,
        color:item.color
      };
      result.push(match);
    }
    return result;
  }

  _renderMatches(matches) {
    // Early exit if there is nothing to render.
    if (matches.length === 0) {
      return;
    }
    const { findController, pageIdx } = this;
    const { textContentItemsStr, textDivs } = this;
    const isSelectedPage = pageIdx === findController.selected.pageIdx;
    const selectedMatchIdx = findController.selected.matchIdx;
    const highlightAll = findController.state.highlightAll;
    let prevEnd = null;
    const infinity = {
      divIdx: -1,
      offset: undefined,
    };

    function beginText(begin, className,color) {
      const divIdx = begin.divIdx;
      textDivs[divIdx].textContent = "";
      return appendTextToDiv(divIdx, 0, begin.offset, className,color);
    }

    function appendTextToDiv(divIdx, fromOffset, toOffset, className,color) {
      let div = textDivs[divIdx];
      if (div.nodeType === Node.TEXT_NODE) {
        const span = document.createElement("span");
        div.parentNode.insertBefore(span, div);
        span.appendChild(div);
        textDivs[divIdx] = span;
        div = span;
      }
      const content = textContentItemsStr[divIdx].substring(
        fromOffset,
        toOffset
      );
      const node = document.createTextNode(content);
      if (className) {
        const span = document.createElement("span");
        // span.className = `${className} appended`;
        span.className = `${className}`;
        // console.log('color',color)
        // span.style.backgroundColor = color
        span.appendChild(node);
        // console.log('span',span)
        div.appendChild(span);
        return className.includes("selected") ? span.offsetLeft : 0;
      }
      div.appendChild(node);
      return 0;
    }

    let i0 = selectedMatchIdx,
      i1 = i0 + 1;
    if (highlightAll) {
      i0 = 0;
      i1 = matches.length;
    } else if (!isSelectedPage) {
      // Not highlighting all and this isn't the selected page, so do nothing.
      return;
    }

    for (let i = i0; i < i1; i++) {
      const match = matches[i];
      const begin = match.begin;
      const xId = match.xId;
      const color = match.begin.color;
      // console.log('bcolor',color)
      const end = match.end;
      const isSelected = isSelectedPage && i === selectedMatchIdx;
      const highlightSuffix = isSelected ? " selected" : "";
      let selectedLeft = 0;

      // Match inside new div.
      if (!prevEnd || begin.divIdx !== prevEnd.divIdx) {
        // If there was a previous div, then add the text at the end.
        if (prevEnd !== null) {
          appendTextToDiv(prevEnd.divIdx, prevEnd.offset, infinity.offset,'',color);
        }
        // Clear the divs and set the content until the starting point.
        beginText(begin,'',color);
      } else {
        appendTextToDiv(prevEnd.divIdx, prevEnd.offset, begin.offset,'',color);
      }

      if (begin.divIdx === end.divIdx) {
        selectedLeft = appendTextToDiv(
          begin.divIdx,
          begin.offset,
          end.offset,
          "highlight" + highlightSuffix,
          color
        );
      } else {
        selectedLeft = appendTextToDiv(
          begin.divIdx,
          begin.offset,
          infinity.offset,
          "highlight begin" + highlightSuffix,
          color
        );
        for (let n0 = begin.divIdx + 1, n1 = end.divIdx; n0 < n1; n0++) {
          textDivs[n0].className = "highlight middle" + highlightSuffix;
          // textDivs[n0].style.backgroundColor = color
        }
        beginText(end, "highlight end" + highlightSuffix,color);
      }
      prevEnd = end;

      if (isSelected) {
        // Attempt to scroll the selected match into view.
        findController.scrollMatchIntoView({
          element: textDivs[begin.divIdx],
          selectedLeft,
          pageIndex: pageIdx,
          matchIndex: selectedMatchIdx,
        });
      }
    }

    if (prevEnd) {
      appendTextToDiv(prevEnd.divIdx, prevEnd.offset, infinity.offset,'',prevEnd.color);
    }
  }

  _updateMatches() {
    if (!this.enabled) {
      return;
    }
    const { findController, matches, pageIdx } = this;
    const { textContentItemsStr, textDivs } = this;
    let clearedUntilDivIdx = -1;

    // Clear all current matches.
    for (let i = 0, ii = matches.length; i < ii; i++) {
      const match = matches[i];
      const begin = Math.max(clearedUntilDivIdx, match.begin.divIdx);
      for (let n = begin, end = match.end.divIdx; n <= end; n++) {
        const div = textDivs[n];
        div.textContent = textContentItemsStr[n];
        div.className = "";
      }
      clearedUntilDivIdx = match.end.divIdx + 1;
    }

    if (!findController?.highlightMatches) {
      return;
    }
    // Convert the matches on the `findController` into the match format
    // used for the textLayer.
    const pageMatches = findController.pageMatches[pageIdx] || null;
    const pageMatchesLength = findController.pageMatchesLength[pageIdx] || null;
    const matchesWithLength = findController.matchesWithLength[pageIdx] //matches长度和位置跟matchesWithLength都对应，mm的位置可以对应到matchesWithLength上面
    // console.log('textContentItemsStr',textContentItemsStr)
    // console.log('text get matchesWithLength',deepCopy(matchesWithLength))
    // console.log('pageMatches',pageMatches,pageMatchesLength)
    //[15, 38, 57, 93, 104, 191, 199, 204, 223, 359]
    //[2, 2, 4, 3, 4, 4, 4, 2, 2, 3] =>pageMatchesLength：匹配的中文字符长度

    this.matches = this._convertMatches(pageMatches, pageMatchesLength,matchesWithLength);
    //[{begin:{divIdx: 18,offset: 0},end:{divIdx: 19,offset: 1}]
    this._renderMatches(this.matches);
  }
}

export { TextHighlighter };

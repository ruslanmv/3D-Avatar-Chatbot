/**
 * AvatarPicker — Bottom-sheet avatar selection panel
 * ===================================================
 * Clean, immersive avatar switcher that replaces the always-visible dropdown.
 *
 * Design pattern: "Avatar icon -> bottom picker panel -> select -> close"
 * Inspired by VRoid Hub / modern character selection UIs.
 *
 * Non-destructive: drives the existing hidden <select#avatar-select> element
 * so all downstream logic (localStorage persistence, loadAvatar, etc.) is reused.
 *
 * Usage: new window.AvatarPicker() after DOM is ready.
 */

'use strict';

(function () {
    class AvatarPicker {
        constructor() {
            this._panel = null;
            this._backdrop = null;
            this._isOpen = false;
            this._triggerBtn = null;

            this._init();
        }

        // =====================================================================
        // INITIALIZATION
        // =====================================================================

        _init() {
            // Hide the native dropdown (keep in DOM for existing logic)
            const nativeSelect = document.getElementById('avatar-select');
            if (nativeSelect) {
                nativeSelect.style.display = 'none';
            }

            // Replace the dropdown area with a small avatar icon button
            this._createTriggerButton();

            // Create the bottom-sheet panel (hidden by default)
            this._createPanel();

            // Listen for avatar changes to update the trigger button tooltip
            if (nativeSelect) {
                nativeSelect.addEventListener('change', () => this._updateTriggerLabel());
            }
        }

        // =====================================================================
        // TRIGGER BUTTON (small icon in the footer)
        // =====================================================================

        _createTriggerButton() {
            // Button is defined in index.html — just find and wire it
            this._triggerBtn = document.getElementById('avatar-picker-btn');
            if (!this._triggerBtn) return;

            var self = this;
            this._triggerBtn.addEventListener('click', function () {
                self.toggle();
            });
        }

        _updateTriggerLabel() {
            var nativeSelect = document.getElementById('avatar-select');
            if (nativeSelect && this._triggerBtn) {
                var selected = nativeSelect.options[nativeSelect.selectedIndex];
                this._triggerBtn.title = selected ? 'Avatar: ' + selected.text : 'Switch Avatar';
            }
        }

        // =====================================================================
        // BOTTOM-SHEET PANEL
        // =====================================================================

        _createPanel() {
            var self = this;

            // Backdrop (click to close)
            this._backdrop = document.createElement('div');
            this._backdrop.className = 'avatar-picker-backdrop';
            this._backdrop.addEventListener('click', function () {
                self.close();
            });
            document.body.appendChild(this._backdrop);

            // Panel
            this._panel = document.createElement('div');
            this._panel.className = 'avatar-picker-panel';

            // Header
            var header = document.createElement('div');
            header.className = 'avatar-picker-header';

            var title = document.createElement('span');
            title.className = 'avatar-picker-title';
            title.textContent = 'SELECT AVATAR';

            var closeBtn = document.createElement('button');
            closeBtn.className = 'avatar-picker-close';
            closeBtn.innerHTML = '\u00D7';
            closeBtn.title = 'Close';
            closeBtn.addEventListener('click', function () {
                self.close();
            });

            header.appendChild(title);
            header.appendChild(closeBtn);
            this._panel.appendChild(header);

            // Avatar grid container
            this._grid = document.createElement('div');
            this._grid.className = 'avatar-picker-grid';
            this._panel.appendChild(this._grid);

            // Upload button at bottom
            var uploadRow = document.createElement('div');
            uploadRow.className = 'avatar-picker-upload-row';

            var uploadBtn = document.createElement('button');
            uploadBtn.className = 'avatar-picker-upload-btn';
            uploadBtn.textContent = '+ Upload Custom Model';
            uploadBtn.addEventListener('click', function () {
                self.close();
                var fileInput = document.getElementById('avatar-upload');
                if (fileInput) fileInput.click();
            });

            uploadRow.appendChild(uploadBtn);
            this._panel.appendChild(uploadRow);

            document.body.appendChild(this._panel);

            // Close on Escape key
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && self._isOpen) self.close();
            });
        }

        // =====================================================================
        // POPULATE GRID FROM NATIVE SELECT
        // =====================================================================

        _populateGrid() {
            var nativeSelect = document.getElementById('avatar-select');
            if (!nativeSelect || !this._grid) return;

            this._grid.innerHTML = '';

            var options = Array.from(nativeSelect.options);
            var selectedIdx = nativeSelect.selectedIndex;
            var self = this;

            options.forEach(function (opt, i) {
                if (!opt.value && opt.value !== '0') return; // Skip placeholder

                var card = document.createElement('button');
                card.className = 'avatar-picker-card';
                if (i === selectedIdx) card.classList.add('active');

                // Avatar initial / icon
                var icon = document.createElement('div');
                icon.className = 'avatar-picker-card-icon';
                icon.textContent = self._getInitial(opt.text);

                // Name
                var name = document.createElement('div');
                name.className = 'avatar-picker-card-name';
                name.textContent = opt.text;

                card.appendChild(icon);
                card.appendChild(name);

                card.addEventListener('click', function () {
                    nativeSelect.selectedIndex = i;
                    nativeSelect.dispatchEvent(new Event('change'));
                    self.close();
                });

                self._grid.appendChild(card);
            });
        }

        _getInitial(name) {
            if (!name) return '?';
            var words = name.trim().split(/\s+/);
            if (words.length >= 2) {
                return (words[0][0] + words[1][0]).toUpperCase();
            }
            return name.substring(0, 2).toUpperCase();
        }

        // =====================================================================
        // OPEN / CLOSE / TOGGLE
        // =====================================================================

        open() {
            if (this._isOpen) return;
            this._isOpen = true;
            this._populateGrid();
            this._backdrop.classList.add('open');
            this._panel.classList.add('open');
        }

        close() {
            if (!this._isOpen) return;
            this._isOpen = false;
            this._backdrop.classList.remove('open');
            this._panel.classList.remove('open');
        }

        toggle() {
            if (this._isOpen) {
                this.close();
            } else {
                this.open();
            }
        }
    }

    // Expose globally
    window.AvatarPicker = AvatarPicker;
})();

/**
 * HTML Template for Shot List
 * 
 * Semantic HTML structure with CSS styling, responsive design, and accessibility
 */

export const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="AI-Generated Shot List">
  <title>{{TITLE}} - Shot List</title>
  <style>
    /* Reset and Base Styles */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --color-primary: #2563eb;
      --color-success: #10b981;
      --color-warning: #f59e0b;
      --color-danger: #ef4444;
      --color-text: #1f2937;
      --color-text-light: #6b7280;
      --color-border: #e5e7eb;
      --color-bg: #ffffff;
      --color-bg-alt: #f9fafb;
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      --font-mono: 'Courier New', Courier, monospace;
      --spacing-xs: 0.25rem;
      --spacing-sm: 0.5rem;
      --spacing-md: 1rem;
      --spacing-lg: 1.5rem;
      --spacing-xl: 2rem;
    }

    body {
      font-family: var(--font-sans);
      color: var(--color-text);
      background: var(--color-bg);
      line-height: 1.6;
      padding: var(--spacing-lg);
    }

    /* Print Styles */
    @media print {
      body {
        padding: 0;
        background: white;
      }
      .no-print {
        display: none !important;
      }
      .shot-card {
        page-break-inside: avoid;
        border: 1px solid #000;
      }
    }

    /* Header */
    .header {
      max-width: 1200px;
      margin: 0 auto var(--spacing-xl);
      padding-bottom: var(--spacing-lg);
      border-bottom: 2px solid var(--color-border);
    }

    .header h1 {
      font-size: 2rem;
      margin-bottom: var(--spacing-sm);
      color: var(--color-primary);
    }

    .metadata {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-md);
      margin-top: var(--spacing-md);
      padding: var(--spacing-md);
      background: var(--color-bg-alt);
      border-radius: 8px;
    }

    .metadata-item {
      display: flex;
      flex-direction: column;
    }

    .metadata-label {
      font-size: 0.875rem;
      color: var(--color-text-light);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .metadata-value {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--color-text);
    }

    /* Shot List Container */
    .shot-list {
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      gap: var(--spacing-lg);
    }

    /* Shot Card */
    .shot-card {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: var(--spacing-lg);
      transition: box-shadow 0.2s ease;
    }

    .shot-card:hover {
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }

    .shot-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: var(--spacing-md);
      padding-bottom: var(--spacing-sm);
      border-bottom: 1px solid var(--color-border);
    }

    .shot-number {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-primary);
    }

    .shot-duration {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      color: var(--color-text-light);
      background: var(--color-bg-alt);
      padding: var(--spacing-xs) var(--spacing-sm);
      border-radius: 4px;
    }

    .shot-scene {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: var(--spacing-sm);
      color: var(--color-text);
    }

    .shot-description {
      font-size: 1rem;
      line-height: 1.8;
      margin-bottom: var(--spacing-md);
      padding: var(--spacing-md);
      background: var(--color-bg-alt);
      border-radius: 4px;
      min-height: 3em;
    }

    /* Editable fields */
    [contenteditable="true"] {
      outline: 2px solid transparent;
      transition: outline-color 0.2s ease;
    }

    [contenteditable="true"]:focus {
      outline-color: var(--color-primary);
      background: white;
    }

    [contenteditable="true"]:hover {
      outline-color: var(--color-border);
    }

    /* Character Counter */
    .char-counter {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      font-size: 0.875rem;
      margin-top: var(--spacing-sm);
    }

    .char-count {
      font-family: var(--font-mono);
      font-weight: 600;
    }

    .char-count.success {
      color: var(--color-success);
    }

    .char-count.warning {
      color: var(--color-warning);
    }

    .char-count.danger {
      color: var(--color-danger);
    }

    .char-progress {
      flex: 1;
      height: 8px;
      background: var(--color-border);
      border-radius: 4px;
      overflow: hidden;
    }

    .char-progress-bar {
      height: 100%;
      transition: width 0.3s ease, background-color 0.3s ease;
      border-radius: 4px;
    }

    .char-progress-bar.success {
      background: var(--color-success);
    }

    .char-progress-bar.warning {
      background: var(--color-warning);
    }

    .char-progress-bar.danger {
      background: var(--color-danger);
    }

    /* Responsive Design */
    @media (max-width: 768px) {
      body {
        padding: var(--spacing-sm);
      }

      .header h1 {
        font-size: 1.5rem;
      }

      .metadata {
        grid-template-columns: 1fr;
      }

      .shot-header {
        flex-direction: column;
        gap: var(--spacing-sm);
      }
    }

    /* Accessibility */
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }

    /* Utility Classes */
    .text-muted {
      color: var(--color-text-light);
    }

    .font-mono {
      font-family: var(--font-mono);
    }

    /* Toolbar Styles */
    .toolbar {
      display: flex;
      gap: var(--spacing-md);
      margin-top: var(--spacing-lg);
      padding: var(--spacing-md);
      background: var(--color-bg-alt);
      border-radius: 8px;
      flex-wrap: wrap;
    }

    .btn {
      padding: var(--spacing-sm) var(--spacing-lg);
      border: none;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs);
    }

    .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .btn:active {
      transform: translateY(0);
    }

    .btn-primary {
      background: var(--color-primary);
      color: white;
    }

    .btn-primary:hover {
      background: #1d4ed8;
    }

    .btn-success {
      background: var(--color-success);
      color: white;
    }

    .btn-success:hover {
      background: #059669;
    }

    .btn-secondary {
      background: var(--color-text-light);
      color: white;
    }

    .btn-secondary:hover {
      background: #4b5563;
    }

    .toast {
      position: fixed;
      bottom: var(--spacing-xl);
      right: var(--spacing-xl);
      padding: var(--spacing-md) var(--spacing-lg);
      background: var(--color-success);
      color: white;
      border-radius: 8px;
      box-shadow: 0 10px 15px rgba(0, 0, 0, 0.1);
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s ease;
      z-index: 1000;
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</head>
<body>
  <header class="header" role="banner">
    <h1>{{TITLE}}</h1>
    <p class="text-muted">{{SUBTITLE}}</p>

    <div class="metadata" role="region" aria-label="Shot list metadata">
      <div class="metadata-item">
        <span class="metadata-label">Total Shots</span>
        <span class="metadata-value" id="total-shots">{{TOTAL_SHOTS}}</span>
      </div>
      <div class="metadata-item">
        <span class="metadata-label">Total Duration</span>
        <span class="metadata-value" id="total-duration">{{TOTAL_DURATION}}</span>
      </div>
      <div class="metadata-item">
        <span class="metadata-label">Total Characters</span>
        <span class="metadata-value" id="total-characters">{{TOTAL_CHARACTERS}}</span>
      </div>
      <div class="metadata-item">
        <span class="metadata-label">Generated</span>
        <span class="metadata-value font-mono">{{GENERATED_DATE}}</span>
      </div>
    </div>

    <!-- Toolbar (hidden when printing) -->
    <div class="toolbar no-print" role="toolbar" aria-label="Shot list actions">
      <button class="btn btn-primary" onclick="saveAsHTML()" aria-label="Download as HTML">
        💾 Download HTML
      </button>
      <button class="btn btn-success" onclick="copyToClipboard()" aria-label="Copy to clipboard">
        📋 Copy to Clipboard
      </button>
      <button class="btn btn-secondary" onclick="exportAsJSON()" aria-label="Export as JSON">
        📄 Export JSON
      </button>
    </div>
  </header>

  <main class="shot-list" role="main" aria-label="Shot list">
    {{SHOTS}}
  </main>

  <!-- Toast notification -->
  <div id="toast" class="toast no-print" role="status" aria-live="polite"></div>

  <script>
    // Character counter functionality
    function updateCharacterCount(element, maxChars = 400) {
      const shotCard = element.closest('.shot-card');
      const counter = shotCard.querySelector('.char-count');
      const progressBar = shotCard.querySelector('.char-progress-bar');

      const text = element.textContent || '';
      const charCount = text.length;
      const percentage = (charCount / maxChars) * 100;

      // Update counter text
      counter.textContent = \`\${charCount} / \${maxChars}\`;

      // Update progress bar
      progressBar.style.width = \`\${Math.min(percentage, 100)}%\`;

      // Update color based on percentage
      // Green: <90% (safe), Yellow: 90-99% (warning), Red: ≥100% (error)
      counter.classList.remove('success', 'warning', 'danger');
      progressBar.classList.remove('success', 'warning', 'danger');

      if (percentage < 90) {
        counter.classList.add('success');
        progressBar.classList.add('success');
      } else if (percentage < 100) {
        counter.classList.add('warning');
        progressBar.classList.add('warning');
      } else {
        counter.classList.add('danger');
        progressBar.classList.add('danger');
      }

      // Update total character count
      updateTotalCharacters();
    }

    // Update total character count across all shots
    function updateTotalCharacters() {
      const descriptions = document.querySelectorAll('.shot-description[contenteditable="true"]');
      let total = 0;
      descriptions.forEach(desc => {
        total += (desc.textContent || '').length;
      });
      document.getElementById('total-characters').textContent = total.toLocaleString();
    }

    // Initialize character counters
    document.addEventListener('DOMContentLoaded', () => {
      const editableFields = document.querySelectorAll('.shot-description[contenteditable="true"]');

      editableFields.forEach(field => {
        const maxChars = parseInt(field.dataset.maxChars || '400', 10);

        // Initial count
        updateCharacterCount(field, maxChars);

        // Update on input
        field.addEventListener('input', () => {
          updateCharacterCount(field, maxChars);
        });
      });
    });

    // Save functionality
    function saveAsHTML() {
      try {
        // Get the entire HTML document
        const htmlContent = document.documentElement.outerHTML;

        // Create a blob with the HTML content
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });

        // Create a download link
        const link = document.createElement('a');
        const title = document.querySelector('h1').textContent.trim();
        const filename = \`\${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-shot-list.html\`;

        link.href = URL.createObjectURL(blob);
        link.download = filename;

        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up
        URL.revokeObjectURL(link.href);

        showToast('✅ HTML file downloaded successfully!');
      } catch (error) {
        showToast('❌ Error downloading HTML: ' + error.message, 'error');
      }
    }

    function copyToClipboard() {
      try {
        // Get the entire HTML document
        const htmlContent = document.documentElement.outerHTML;

        // Copy to clipboard using the Clipboard API
        navigator.clipboard.writeText(htmlContent).then(() => {
          showToast('✅ HTML copied to clipboard!');
        }).catch(err => {
          // Fallback for older browsers
          const textarea = document.createElement('textarea');
          textarea.value = htmlContent;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          showToast('✅ HTML copied to clipboard!');
        });
      } catch (error) {
        showToast('❌ Error copying to clipboard: ' + error.message, 'error');
      }
    }

    function exportAsJSON() {
      try {
        // Extract shot data from the DOM
        const shots = [];
        const shotCards = document.querySelectorAll('.shot-card');

        shotCards.forEach(card => {
          const shotNumber = card.querySelector('.shot-number').textContent.trim();
          const duration = card.querySelector('.shot-duration').textContent.trim();
          const sceneHeading = card.querySelector('.shot-scene').textContent.trim();
          const description = card.querySelector('.shot-description').textContent.trim();
          const charCount = card.querySelector('.char-count').textContent.split('/')[0].trim();

          shots.push({
            shotNumber,
            duration,
            sceneHeading,
            description,
            characterCount: parseInt(charCount, 10)
          });
        });

        const data = {
          title: document.querySelector('h1').textContent.trim(),
          subtitle: document.querySelector('.text-muted').textContent.trim(),
          totalShots: document.getElementById('total-shots').textContent.trim(),
          totalDuration: document.getElementById('total-duration').textContent.trim(),
          totalCharacters: document.getElementById('total-characters').textContent.trim(),
          generatedDate: document.querySelector('.metadata-value.font-mono').textContent.trim(),
          shots
        };

        // Create JSON blob
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

        // Create download link
        const link = document.createElement('a');
        const filename = \`\${data.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-shot-list.json\`;

        link.href = URL.createObjectURL(blob);
        link.download = filename;

        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up
        URL.revokeObjectURL(link.href);

        showToast('✅ JSON file exported successfully!');
      } catch (error) {
        showToast('❌ Error exporting JSON: ' + error.message, 'error');
      }
    }

    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.style.background = type === 'error' ? 'var(--color-danger)' : 'var(--color-success)';
      toast.classList.add('show');

      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }
  </script>
</body>
</html>`;

/**
 * Shot card template
 */
export const SHOT_CARD_TEMPLATE = `
<article class="shot-card" role="article" aria-labelledby="shot-{{SHOT_NUMBER}}-title">
  <div class="shot-header">
    <h2 class="shot-number" id="shot-{{SHOT_NUMBER}}-title">
      <span class="sr-only">Shot</span> {{SHOT_NUMBER}}
    </h2>
    <span class="shot-duration" aria-label="Duration">{{DURATION}}</span>
  </div>

  <div class="shot-scene" aria-label="Scene heading">
    {{SCENE_HEADING}}
  </div>

  <div
    class="shot-description"
    contenteditable="true"
    role="textbox"
    aria-label="Shot description (editable)"
    aria-multiline="true"
    data-max-chars="{{MAX_CHARS}}"
  >{{DESCRIPTION}}</div>

  <div class="char-counter" aria-live="polite">
    <span class="char-count success">{{CHAR_COUNT}} / {{MAX_CHARS}}</span>
    <div class="char-progress" role="progressbar" aria-valuenow="{{CHAR_PERCENTAGE}}" aria-valuemin="0" aria-valuemax="100">
      <div class="char-progress-bar success" style="width: {{CHAR_PERCENTAGE}}%"></div>
    </div>
  </div>
</article>
`;


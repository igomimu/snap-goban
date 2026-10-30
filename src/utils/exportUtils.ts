declare const chrome: any;

// COLOR_NAME_MAP removed, replaced by normalizeSvgColors internal logic
// normalizeColorValue deprecated

const OFF_BLACK = '#000001';
const OFF_WHITE = '#FEFEFE';

function normalizeSvgColors(svgElement: SVGSVGElement): void {
    const attributesToNormalize = ['fill', 'stroke', 'color', 'stop-color'];
    // Select ALL elements to ensure we catch everything
    const elements = svgElement.querySelectorAll('*');

    // 1. Force Root Background (Simple)
    if (svgElement.style) {
        svgElement.style.backgroundColor = OFF_WHITE;
    }

    elements.forEach(el => {
        // 2. Normalize Attributes to Off-Colors
        attributesToNormalize.forEach(attr => {
            const value = el.getAttribute(attr);
            if (!value) return;
            const lower = value.toLowerCase().trim();
            // Word は保存時に transparent を #000000 に変える
            if (lower === 'transparent') {
                el.setAttribute(attr, 'none');
                return;
            }
            if (lower === 'black' || lower === '#000' || lower === '#000000') {
                el.setAttribute(attr, OFF_BLACK);
            } else if (lower === 'white' || lower === '#fff' || lower === '#ffffff') {
                el.setAttribute(attr, OFF_WHITE);
            }
        });

        // 3. Normalize Inline Styles (Attribute replacement ONLY)
        const element = el as HTMLElement;
        if (element.style) {
            const style = el.getAttribute('style') || '';
            if (style.includes('fill:') || style.includes('stroke:') || style.includes('color:')) {
                const newStyle = style.replace(/black/gi, OFF_BLACK).replace(/#000000/gi, OFF_BLACK)
                    .replace(/white/gi, OFF_WHITE).replace(/#ffffff/gi, OFF_WHITE);
                el.setAttribute('style', newStyle);
            }
        }
    });

    // 3. Remove all <style> tags to prevent Media Query confusion in Word
    const styleTags = svgElement.querySelectorAll('style');
    styleTags.forEach(tag => tag.remove());
}



/**
 * Exports an SVG element to the system clipboard as a PNG image.
 * Uses a Canvas to rasterize the SVG at a high resolution.
 *
 * FIX v22:
 * - Accept optional backgroundColor.
 * - Remove elements marked with data-export-ignore="true" (like selection rect).
 */
/**
 * Prepares an SVG element for export by cloning, cleaning, and applying necessary styles.
 * This ensures "Dark Mode hardening" and Word compatibility.
 */
export function prepareSvgForExport(svgElement: SVGSVGElement, options: { backgroundColor?: string, omitBackground?: boolean } = {}): SVGSVGElement {
    const { backgroundColor = '#DCB35C', omitBackground = false } = options;

    // 1. Clone the SVG to manipulate it without affecting the DOM
    const clone = svgElement.cloneNode(true) as SVGSVGElement;

    // 2. Remove "data-export-ignore" elements (e.g. selection rect)
    const ignoredElements = clone.querySelectorAll('[data-export-ignore="true"]');
    ignoredElements.forEach(el => el.remove());

    // 3. Get the crop aspect ratio / dimensions from viewBox
    let width, height, minX = 0, minY = 0;

    if (clone.getAttribute('viewBox')) {
        const vb = clone.getAttribute('viewBox')!.split(' ').map(Number);
        minX = vb[0];
        minY = vb[1];
        width = vb[2];
        height = vb[3];
    } else {
        const bBox = svgElement.getBoundingClientRect();
        width = bBox.width;
        height = bBox.height;
        clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    // 4. FORCE Width/Height Attributes to match viewBox (Pixels)
    clone.setAttribute('width', `${width}px`);
    clone.setAttribute('height', `${height}px`);

    // HOTFIX: Simplified styles for Word
    // Removing filter/color-scheme as they cause import errors
    clone.style.filter = '';
    clone.style.colorScheme = '';

    // SVG Cleanup: Remove all class attributes and style tags (Clean Slate)
    const allElements = clone.querySelectorAll('*');
    allElements.forEach(el => el.removeAttribute('class'));
    clone.removeAttribute('class');
    const styleTags = clone.querySelectorAll('style');
    styleTags.forEach(el => el.remove());

    // 5. Handle Background Color
    // Fix Background Color for Word:
    // Word treats pure #FFFFFF as "transparent" sometimes. Use #FEFEFE (Off-white) to force rendering.
    let finalBgColor = backgroundColor || "#FEFEFE";
    if (finalBgColor.toLowerCase() === '#ffffff' || finalBgColor.toLowerCase() === 'white') {
        finalBgColor = '#FEFEFE';
    }

    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", String(minX));
    bgRect.setAttribute("y", String(minY));
    bgRect.setAttribute("width", String(width));
    bgRect.setAttribute("height", String(height));
    bgRect.setAttribute("fill", finalBgColor);

    // Word Compatibility: Explicit inline styles (Simplified)
    // bgRect.style.fill = finalBgColor; // Not strictly needed if attribute is present and no classes
    bgRect.style.stroke = "none";

    // Word Compatibility: Set background on root (sometimes helps)
    clone.style.backgroundColor = finalBgColor;

    // Insert as first child to be behind all content
    if (omitBackground) {
        clone.style.backgroundColor = '';
    } else if (clone.firstChild) {
        clone.insertBefore(bgRect, clone.firstChild);
    } else {
        clone.appendChild(bgRect);
    }

    // Word sometimes remaps named colors on re-open; force explicit hex values.
    normalizeSvgColors(clone);

    return clone;
}

/**
 * Exports an SVG element to the system clipboard as a PNG image.
 */
export async function exportToPng(svgElement: SVGSVGElement, options: { scale?: number, backgroundColor?: string, destination?: 'CLIPBOARD' | 'DOWNLOAD', filename?: string } = {}): Promise<void> {
    // Default background is undefined (transparent) unless specified
    const { scale = 1, backgroundColor, destination = 'CLIPBOARD', filename = '' } = options;

    // Pass backgroundColor (could be undefined)
    const clone = prepareSvgForExport(svgElement, { backgroundColor });
    const width = parseFloat(clone.getAttribute('width') || '0');
    const height = parseFloat(clone.getAttribute('height') || '0');

    try {
        // svgToPngBlob will handle undefined backgroundColor (transparent logic)
        const blob = await svgToPngBlob(clone, width, height, scale, backgroundColor);
        if (destination === 'CLIPBOARD') {
            window.focus();
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            console.log('Image copied to clipboard successfully.');
        } else {
            await saveFile(blob, filename, 'PNG Image', 'image/png');
        }
    } catch (error) {
        console.error('Export failed', error);
        alert(destination === 'CLIPBOARD' ? 'クリップボードへのコピーに失敗しました。' : '画像の保存に失敗しました。');
    }
}

/**
 * Helper to rasterize SVG to PNG Blob
 */
export async function svgToPngBlob(svgElement: SVGSVGElement, width: number, height: number, scale: number, backgroundColor: string | undefined): Promise<Blob> {
    // FORCE Light Mode styles for Canvas rendering (Fixes Dark Mode Inversion)
    // We modify the cloned element directly before serialization for image source.
    svgElement.style.setProperty('color-scheme', 'light', 'important');
    svgElement.style.setProperty('filter', 'none', 'important');
    // Ensure text fill is correct if it relied on inheritance
    svgElement.style.fill = OFF_BLACK;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();

    try {
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = (e) => reject(e);
            img.src = url;
        });

        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas Context Failed');

        // Fill background ONLY if specified
        if (backgroundColor) {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);

        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('Could not generate PNG blob'));
            }, 'image/png');
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Exports an SVG element to the system clipboard as SVG text.
 */


/**
 * Word に貼る SVG を GoWrite の見た目に寄せる。
 * 画面用の non-scaling-stroke は Word で縮小されると線が極端に細くなるので外し、太さを図の単位（1路=40）で決める。
 */
function styleForWord(svg: SVGSVGElement, monochrome: boolean): void {
    svg.querySelectorAll('[vector-effect]').forEach(el => el.removeAttribute('vector-effect'));
    svg.querySelectorAll('line[data-grid]').forEach(el =>
        el.setAttribute('stroke-width', el.getAttribute('data-grid') === 'border' ? '5' : '1.6'));
    // 図より下を隠す覆いは、背景なしでは紙と同じ純白に（#FEFEFE だと薄い箱が見える）
    if (monochrome) svg.querySelectorAll('rect[data-cover]').forEach(el => el.setAttribute('fill', '#FFFFFF'));
}

/**
 * Exports an SVG element to the system clipboard as SVG text.
 * Matches PNG behavior (Copy instead of Download).
 */
export async function exportToSvg(svgElement: SVGSVGElement, options: { backgroundColor?: string, destination?: 'CLIPBOARD' | 'DOWNLOAD', filename?: string } = {}): Promise<void> {
    // Default background is undefined (transparent)
    const { backgroundColor, destination = 'CLIPBOARD', filename = '' } = options;

    // 白黒の図は GoWrite と同じく背景なし（Wordの紙にそのまま乗る）
    const monochrome = !!backgroundColor && ['#fefefe', '#ffffff', 'white'].includes(backgroundColor.toLowerCase());
    const clone = prepareSvgForExport(svgElement, { backgroundColor, omitBackground: monochrome });
    const width = parseFloat(clone.getAttribute('width') || '0');
    const height = parseFloat(clone.getAttribute('height') || '0');
    styleForWord(clone, monochrome);

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);

    if (destination === 'DOWNLOAD') {
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        await saveFile(svgBlob, filename, 'SVG Image', 'image/svg+xml');
        return;
    }

    try {
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
        // PNG Fallback provided but potentially ignored by Word in favor of SVG
        const pngBlob = await svgToPngBlob(clone, width, height, 4, backgroundColor);

        window.focus();
        await navigator.clipboard.write([
            new ClipboardItem({
                'image/svg+xml': svgBlob,
                'image/png': pngBlob
            })
        ]);
        console.log('SVG content copied to clipboard.');
    } catch (error) {
        console.error('Failed to copy SVG to clipboard:', error);
        alert('Failed to copy SVG. Please check permissions.');
    }
}

/**
 * Exports an SVG element to EMF format via Inkscape (Desktop Version Only)
 */
export async function exportToEmf(svgElement: SVGSVGElement, options: { backgroundColor?: string, destination?: 'CLIPBOARD' | 'DOWNLOAD', filename?: string } = {}): Promise<void> {
    const { backgroundColor, destination = 'DOWNLOAD', filename = 'output.emf' } = options;

    const clone = prepareSvgForExport(svgElement, { backgroundColor });
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);

    // Check if we are in Electron and the and the API is exposed
    const electron = (window as any).electron;
    if (electron && electron.exportToEmf) {
        try {
            const mode = destination === 'CLIPBOARD' ? 'clipboard' : 'file';
            const result = await electron.exportToEmf(svgString, { filename, mode });
            if (result.success) {
                console.log('EMF Export successful');
            } else {
                if (result.error !== 'User cancelled') {
                    alert('EMF Export failed: ' + result.error);
                }
            }
        } catch (error: any) {
            console.error('EMF Export error:', error);
            alert('EMF Export failed: ' + error.message);
        }
    } else {
        alert('EMF Export is only supported in the desktop version (Snap Goban Desktop).');
    }
}



/**
 * Common Helper: Save Blob
 */
export async function saveFile(blob: Blob, filename: string, typeDescription: string, mimeType: string) {
    if ('showSaveFilePicker' in window) {
        try {
            const pickerOptions: any = {
                id: 'snap-goban-export', // specific ID to remember location
                types: [{
                    description: typeDescription,
                    accept: { [mimeType]: ['.' + (filename ? filename.split('.').pop() : (mimeType.includes('png') ? 'png' : (mimeType.includes('gif') ? 'gif' : 'svg')))] }
                }]
            };
            if (filename) pickerOptions.suggestedName = filename;
            // @ts-ignore
            const handle = await window.showSaveFilePicker(pickerOptions);
            // @ts-ignore
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (e) {
            if ((e as Error).name === 'AbortError') return;
            console.warn('FilePicker fallback...', e);
        }
    }
    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
        const url = URL.createObjectURL(blob);
        try {
            await new Promise<void>((resolve, reject) => {
                const downloadOptions: any = {
                    url: url,
                    saveAs: true,
                    conflictAction: 'overwrite'
                };
                if (filename) downloadOptions.filename = filename;
                else {
                    const ext = mimeType.includes('gif') ? 'gif' : (mimeType.includes('svg') ? 'svg' : 'png');
                    downloadOptions.filename = `game.${ext}`;
                }
                chrome.downloads.download(downloadOptions, (_dId: number) => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve();
                });
            });
            URL.revokeObjectURL(url);
            return;
        } catch (e: any) {
            URL.revokeObjectURL(url);
            if (e && (e.message === 'I_USER_CANCELLED' || e.message.includes('cancel'))) return;
            alert('保存できませんでした: ' + (e.message || e));
            return;
        }
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    if (filename) link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

export async function promptSaveFile(mimeType: string, filename: string): Promise<any | null> {
    if (!('showSaveFilePicker' in window)) return null;
    try {
        const typeDescription = mimeType.split('/')[1].toUpperCase() + ' File';
        const pickerOptions: any = {
            id: 'snap-goban-export',
            types: [{
                description: typeDescription,
                accept: { [mimeType]: ['.' + (filename ? filename.split('.').pop() : (mimeType.includes('png') ? 'png' : (mimeType.includes('gif') ? 'gif' : 'svg')))] }
            }]
        };
        if (filename) pickerOptions.suggestedName = filename;
        // @ts-ignore
        return await window.showSaveFilePicker(pickerOptions);
    } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        return null;
    }
}
export async function writeToHandle(handle: any, blob: Blob) {
    // @ts-ignore
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
}
export const getFileHandle = promptSaveFile;

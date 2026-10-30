import { forwardRef, useMemo } from 'react';
import { OFF_BLACK, OFF_WHITE } from '../constants';

// Removed ViewRange reference - we use full board always now?
// Actually App.tsx still uses viewRange state, but we are "abolishing X-Range Y-Range UI".
// But keeping viewRange logic inside GoBoard allows for selection trimming if we ever need it.
// For now, let's keep ViewRange interface but default it to full board if not passed?
// Or just derive it from Size.

export interface ViewRange {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export type StoneColor = 'BLACK' | 'WHITE';

export interface Stone {
    color: StoneColor;
    number?: number;
}

export type BoardState = (Stone | null)[][];

export interface Marker {
    x: number;
    y: number;
    type: 'LABEL' | 'SYMBOL';
    value: string; // 'A'...'Z' or 'TRI','CIR','SQR','X'
}

export interface GoBoardProps {
    boardState: BoardState;
    boardSize: number; // 19, 13, 9

    viewRange?: ViewRange; // Optional now?
    showCoordinates?: boolean;
    showNumbers?: boolean;
    isMonochrome?: boolean;
    prioritizeLabel?: boolean; // Toggle Number vs Label priority

    // Interactions
    onCellClick: (x: number, y: number) => void;
    onCellRightClick: (x: number, y: number) => void;
    onBoardWheel: (delta: number) => void;
    onCellMouseEnter: (x: number, y: number) => void;
    onCellMouseLeave: () => void;

    // Drag Selection / Move
    selectionStart: { x: number, y: number } | null;
    selectionEnd?: { x: number, y: number } | null;

    onDragStart: (x: number, y: number) => void;
    onDragMove: (x: number, y: number) => void;
    onDragEnd?: () => void;
    hiddenMoves?: {
        left: { text: string, color: StoneColor }[];
        right: { text: string, color?: StoneColor, isLabel?: boolean };
    }[];
    specialLabels?: { x: number, y: number, label: string }[];
    markers?: Marker[];
    nextNumber?: number;
    activeColor?: StoneColor;
    readOnly?: boolean;
    // Branching Support
    nextMoves?: { x: number, y: number, color: StoneColor, id: string }[];
    onNextMoveClick?: (id: string) => void;
}

const GoBoard = forwardRef<SVGSVGElement, GoBoardProps>(({
    boardState,
    boardSize,
    viewRange,
    showCoordinates = false,
    showNumbers = true,
    isMonochrome = false,
    prioritizeLabel = false,
    onCellClick,
    onCellRightClick,
    onBoardWheel,
    onCellMouseEnter,
    onCellMouseLeave,
    selectionStart,
    selectionEnd,
    onDragStart,
    onDragMove,
    onDragEnd,
    hiddenMoves = [],
    specialLabels = [],
    markers = [],
    readOnly = false,
    nextMoves = [],
    onNextMoveClick
}, ref) => {
    const CELL_SIZE = 40;
    const MARGIN = 40;

    // Use passed viewRange or default to full board
    const effectiveViewRange = viewRange || {
        minX: 1, maxX: boardSize, minY: 1, maxY: boardSize
    };

    // Visual Tuning Constants (Reverted to Integer for Pixel-Perfect Rendering)
    // Decimal values (1.25, 2.5) caused subpixel rendering issues
    const LINE_WIDTH = 1;
    const BORDER_WIDTH = 2;
    const STONE_RADIUS = CELL_SIZE * 0.46;
    const FONT_SIZE = CELL_SIZE * 0.65;
    const COORD_FONT_SIZE = 14;
    const STAR_POINT_RADIUS = 3.5;

    const getStarPoints = (size: number) => {
        const s = Number(size);
        if (s === 19) {
            return [
                [4, 4], [10, 4], [16, 4],
                [4, 10], [10, 10], [16, 10],
                [4, 16], [10, 16], [16, 16]
            ];
        } else if (s === 13) {
            return [
                [4, 4], [7, 4], [10, 4],
                [4, 7], [7, 7], [10, 7],
                [4, 10], [7, 10], [10, 10]
            ];
        } else if (s === 9) {
            return [
                [3, 3], [7, 3],
                [5, 5],
                [3, 7], [7, 7]
            ];
        }
        return [];
    };

    const starPoints = getStarPoints(boardSize);

    const viewBoxData = useMemo(() => {
        const { minX, maxX, minY, maxY } = effectiveViewRange;

        // Ensure range is within bounds (if switching sizes happened)
        const validMinX = Math.max(1, minX);
        const validMaxX = Math.min(boardSize, maxX);
        const validMinY = Math.max(1, minY);
        const validMaxY = Math.min(boardSize, maxY);

        // Fallback if fully out of bounds
        if (validMinX > validMaxX || validMinY > validMaxY) {
            // Reset to full
            const w = boardSize * CELL_SIZE;
            const h = boardSize * CELL_SIZE;
            return { x: MARGIN - CELL_SIZE / 2, y: MARGIN - CELL_SIZE / 2, w, h, str: `${MARGIN - CELL_SIZE / 2} ${MARGIN - CELL_SIZE / 2} ${w} ${h}` };
        }

        const x = MARGIN + (validMinX - 1) * CELL_SIZE - CELL_SIZE / 2;
        const y = MARGIN + (validMinY - 1) * CELL_SIZE - CELL_SIZE / 2;
        const width = (validMaxX - validMinX + 1) * CELL_SIZE;
        let height = (validMaxY - validMinY + 1) * CELL_SIZE;

        let finalX = x;
        let finalY = y;
        let finalW = width;
        let finalH = height;

        if (showCoordinates) {
            finalX -= 25;
            finalY -= 25;
            finalW += 50;
            finalH += 50;
        }

        // Add footer space for hidden moves (OUTSIDE the board grid)
        if (hiddenMoves.length > 0) {
            const rows = Math.ceil(hiddenMoves.length / 4);
            const footerHeight = rows * 40;
            const footerSpacing = 80; // Spacing from board (Matched with render)
            const footerPadding = 20; // Extra padding at bottom
            finalH += footerHeight + footerSpacing + footerPadding;
        }

        return { x: finalX, y: finalY, w: finalW, h: finalH, str: `${finalX} ${finalY} ${finalW} ${finalH}` };
    }, [viewRange, showCoordinates, boardSize, hiddenMoves]);

    // Generate lines
    const lines = [];
    for (let i = 1; i <= boardSize; i++) {
        const pos = MARGIN + (i - 1) * CELL_SIZE;
        const start = MARGIN;
        const end = MARGIN + (boardSize - 1) * CELL_SIZE;

        const isBorder = i === 1 || i === boardSize;
        const width = isBorder ? BORDER_WIDTH : LINE_WIDTH;

        lines.push(
            <line
                key={`v-${i}`}
                x1={pos} y1={start}
                x2={pos} y2={end}
                stroke={OFF_BLACK}
                strokeWidth={width}
                strokeLinecap="square"
                className="grid-line"
                data-grid={isBorder ? 'border' : 'line'}
                shapeRendering="crispEdges"
                vectorEffect="non-scaling-stroke"
            />
        );
        lines.push(
            <line
                key={`h-${i}`}
                x1={start} y1={pos}
                x2={end} y2={pos}
                stroke={OFF_BLACK}
                strokeWidth={width}
                strokeLinecap="square"
                className="grid-line"
                data-grid={isBorder ? 'border' : 'line'}
                shapeRendering="crispEdges"
                vectorEffect="non-scaling-stroke"
            />
        );
    }

    // Generate Coordinates
    const coords = [];
    if (showCoordinates) {

        // Dynamic generation:
        const getLabel = (n: number) => {
            if (n >= 9) n++; // skip I
            return String.fromCharCode(64 + n);
        };

        for (let i = 1; i <= boardSize; i++) {
            const pos = MARGIN + (i - 1) * CELL_SIZE;
            // Top Labels
            coords.push(
                <text
                    key={`cx-${i}`} x={pos} y={MARGIN - 25} textAnchor="middle" fontSize={COORD_FONT_SIZE} fill={OFF_BLACK} fontFamily="sans-serif" fontWeight="bold"
                    style={{ WebkitFontSmoothing: 'none', fontSmooth: 'never' } as any}
                >
                    {getLabel(i)}
                </text>
            );
            // Left Labels
            coords.push(
                <text
                    key={`cy-${i}`} x={MARGIN - 25} y={pos + 5} textAnchor="middle" fontSize={COORD_FONT_SIZE} fill={OFF_BLACK} fontFamily="sans-serif" fontWeight="bold"
                    style={{ WebkitFontSmoothing: 'none', fontSmooth: 'never' } as any}
                >
                    {boardSize - i + 1}
                </text>
            );
        }
    }

    // Draw stones
    const cells = [];
    // Safety check for boardState size vs boardSize
    // If state is 19x19 but mode is 13, we only loop to 13?
    // Yes, ignore outer stones.

    for (let y = 1; y <= boardSize; y++) {
        for (let x = 1; x <= boardSize; x++) {
            const cx = MARGIN + (x - 1) * CELL_SIZE;
            const cy = MARGIN + (y - 1) * CELL_SIZE;

            const stone = (boardState[y - 1] && boardState[y - 1][x - 1]);

            // Interaction Area
            if (!readOnly) {
                cells.push(
                    <rect
                        key={`click-${x}-${y}`}
                        x={cx - CELL_SIZE / 2}
                        y={cy - CELL_SIZE / 2}
                        width={CELL_SIZE}
                        height={CELL_SIZE}
                        fill="transparent"
                        // Wordは保存時に transparent を黒に変える（盤が黒で覆われ白黒反転に見える）ので書き出しから除く
                        data-export-ignore="true"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            if (e.buttons === 1) onDragStart(x, y);
                        }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            onCellRightClick(x, y);
                        }}
                        onMouseEnter={(e) => {
                            onCellMouseEnter(x, y);
                            if (e.buttons === 1) onDragMove(x, y);
                        }}
                        onMouseLeave={() => {
                            onCellMouseLeave();
                        }}
                        onMouseUp={onDragEnd}
                        onClick={() => onCellClick(x, y)}
                        className="cursor-pointer hover:fill-blue-500 hover:fill-opacity-10"
                    />
                );
            }

            if (stone) {
                const isBlack = stone.color === 'BLACK';
                const label = specialLabels.find(l => l.x === x && l.y === y)?.label;

                // Priority Logic:
                // If prioritizeLabel is TRUE (Export Mode), prefer Label (A) to match Legend.
                // If prioritizeLabel is FALSE (Operation Mode), prefer Number (11).
                // Updated Logic: Check showNumbers.
                // If showNumbers is FALSE, we hide numbers, but we might still show Labels?
                // Yes, usually "No Numbers" means "Just stones". But if a Label was explicitly set, maybe show it?
                // Let's assume toggle only affects Move Numbers. Labels are markers.

                const numText = showNumbers ? stone.number?.toString() : undefined;

                const displayText = prioritizeLabel
                    ? (label || numText)
                    : (numText || label);

                cells.push(
                    <g key={`s-group-${x}-${y}`} className="pointer-events-none">
                        <circle
                            cx={cx} cy={cy} r={STONE_RADIUS}
                            fill={isBlack ? "#000000" : "#FFFFFF"}
                            stroke={isBlack ? "#000000" : "#000000"}
                            strokeWidth={isBlack ? 2 : 2.0}
                            className={isBlack ? "black-stone" : "white-stone"}
                        // Removed crispEdges from stones for smoothness
                        />
                        {displayText && (
                            <text
                                x={cx} y={cy}
                                dy=".35em"
                                textAnchor="middle"
                                fill={isBlack ? "#FFFFFF" : "#000000"}
                                fontSize={(displayText && displayText.length >= 3) ? CELL_SIZE * 0.45 : FONT_SIZE}
                                fontFamily="Arial, sans-serif"
                                fontWeight="bold"
                                style={{ WebkitFontSmoothing: 'none', fontSmooth: 'never' } as any}
                                className="board-marker"
                            >
                                {displayText}
                            </text>
                        )}
                    </g>
                );
            }
        }
    }

    // Markers (Labels / Symbols)
    const markerElements: JSX.Element[] = [];
    if (markers) {
        markers.forEach((m, i) => {
            const cx = MARGIN + (m.x - 1) * CELL_SIZE;
            const cy = MARGIN + (m.y - 1) * CELL_SIZE;
            const stone = boardState[m.y - 1]?.[m.x - 1];
            const isBlackStone = stone?.color === 'BLACK';
            const baseColor = isBlackStone ? OFF_WHITE : OFF_BLACK;

            if (m.type === 'LABEL') {
                markerElements.push(
                    <text
                        key={`mk-lbl-${i}`}
                        x={cx} y={cy}
                        dy=".35em"
                        textAnchor="middle"
                        fontSize={FONT_SIZE}
                        fill={baseColor}
                        fontFamily="Arial, sans-serif"
                        fontWeight="bold"
                        style={{ pointerEvents: 'none', userSelect: 'none' } as React.CSSProperties}
                        className="board-marker"
                    >
                        {m.value}
                    </text>
                );
            } else if (m.type === 'SYMBOL') {
                const r = CELL_SIZE * 0.25;
                if (m.value === 'SQR') {
                    markerElements.push(<rect key={`mk-sym-${i}`} x={cx - r} y={cy - r} width={r * 2} height={r * 2} stroke={baseColor} strokeWidth={2} fill="none" pointerEvents="none" className="board-marker" />);
                } else if (m.value === 'TRI') {
                    const points = `${cx},${cy - r} ${cx + r * 0.866},${cy + r * 0.5} ${cx - r * 0.866},${cy + r * 0.5}`;
                    markerElements.push(<polygon key={`mk-sym-${i}`} points={points} stroke={baseColor} strokeWidth={2} fill="none" pointerEvents="none" className="board-marker" />);
                } else if (m.value === 'CIR') {
                    markerElements.push(<circle key={`mk-sym-${i}`} cx={cx} cy={cy} r={r} stroke={baseColor} strokeWidth={2} fill="none" pointerEvents="none" className="board-marker" />);
                } else if (m.value === 'X') {
                    const d = r * 0.8;
                    markerElements.push(
                        <g key={`mk-sym-${i}`} stroke={baseColor} strokeWidth={2} pointerEvents="none" className="board-marker">
                            <line x1={cx - d} y1={cy - d} x2={cx + d} y2={cy + d} />
                            <line x1={cx + d} y1={cy - d} x2={cx - d} y2={cy + d} />
                        </g>
                    );
                }
            }
        });
    }

    // Selection Overlay
    let selectionRect = null;
    if (selectionStart && selectionEnd) {
        const x1 = Math.min(selectionStart.x, selectionEnd.x);
        const x2 = Math.max(selectionStart.x, selectionEnd.x);
        const y1 = Math.min(selectionStart.y, selectionEnd.y);
        const y2 = Math.max(selectionStart.y, selectionEnd.y);

        // Clamp to board size
        if (x1 <= boardSize && y1 <= boardSize) {
            const cx1 = Math.max(1, x1);
            const cx2 = Math.min(boardSize, x2);
            const cy1 = Math.max(1, y1);
            const cy2 = Math.min(boardSize, y2);

            const sx = MARGIN + (cx1 - 1) * CELL_SIZE - CELL_SIZE / 2;
            const sy = MARGIN + (cy1 - 1) * CELL_SIZE - CELL_SIZE / 2;
            const w = (cx2 - cx1 + 1) * CELL_SIZE;
            const h = (cy2 - cy1 + 1) * CELL_SIZE;

            selectionRect = (
                <rect
                    key="selection-rect-overlay"
                    x={sx} y={sy} width={w} height={h}
                    fill="rgba(0, 0, 255, 0.2)"
                    stroke="blue"
                    strokeWidth={2}
                    pointerEvents="none"
                    className="selection-overlay"
                    id="selection-overlay-rect"
                />
            );
        }
    }

    return (
        <svg
            ref={ref}
            viewBox={viewBoxData.str}
            xmlns="http://www.w3.org/2000/svg"
            className="select-none"
            preserveAspectRatio="xMidYMid meet"
            onMouseUp={onDragEnd}
            onMouseLeave={onDragEnd}
            onWheel={(e) => onBoardWheel(e.deltaY)}
            style={{
                display: 'block',
                aspectRatio: viewBoxData.str.split(' ')[2] + ' / ' + viewBoxData.str.split(' ')[3],
                printColorAdjust: 'exact',
                WebkitPrintColorAdjust: 'exact'
            }}
        >
            <defs>
            </defs>

            {/* Background Rect for Printing robustness */}
            <rect
                data-export-ignore="true"
                x={viewBoxData.x}
                y={viewBoxData.y}
                width={viewBoxData.w}
                height={viewBoxData.h}
                fill={isMonochrome ? OFF_WHITE : '#DCB35C'}
                stroke="none"
                style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
            />

            {lines}

            {coords}

            {starPoints.map(([sx, sy]) => (
                <circle
                    key={`star-${sx}-${sy}`}
                    cx={MARGIN + (sx - 1) * CELL_SIZE}
                    cy={MARGIN + (sy - 1) * CELL_SIZE}
                    r={STAR_POINT_RADIUS}
                    fill={OFF_BLACK}
                // Removed crispEdges from stars for smoothness
                />
            ))}

            {cells}

            {/* Ghost Stones for Branches */}
            {!readOnly && nextMoves.map((move) => {
                const cx = MARGIN + (move.x - 1) * CELL_SIZE;
                const cy = MARGIN + (move.y - 1) * CELL_SIZE;
                const isBlack = move.color === 'BLACK';

                // Render a smaller, semi-transparent stone
                return (
                    <g
                        key={`ghost-${move.id}`}
                        data-export-ignore="true"
                        className="cursor-pointer"
                        onClick={(e) => {
                            e.stopPropagation(); // Prevent onCellClick (new move)
                            if (onNextMoveClick) onNextMoveClick(move.id);
                        }}
                    >
                        <circle
                            cx={cx} cy={cy}
                            r={STONE_RADIUS * 0.6} // Created slightly smaller
                            fill={isBlack ? "black" : "white"}
                            stroke={OFF_BLACK}
                            strokeWidth={1}
                            opacity={0.5}
                        />
                        {/* Optional: Add a small marker to indicate it's a branch? */}
                        <circle cx={cx} cy={cy} r={3} fill={isBlack ? "#FFFFFF" : "#000000"} opacity={0.8} />
                    </g>
                );
            })}

            {selectionRect}
            {markerElements}

            {/* Footer Text for Hidden Moves */}
            {hiddenMoves.length > 0 && (() => {
                const { minX, maxX, minY: __, maxY } = viewRange || { minX: 1, maxX: boardSize, minY: 1, maxY: boardSize };
                const validMinX = Math.max(1, minX);
                const validMaxX = Math.min(boardSize, maxX);
                const validMaxY = Math.min(boardSize, maxY);

                // Start Position: Below board (Footer)
                // Reduced spacing to 40px (approx 1 cell) to save space.
                const startX = MARGIN + (validMinX - 1) * CELL_SIZE - CELL_SIZE / 2 + (showCoordinates ? -25 : 0) + 10;
                const startY = MARGIN + (validMaxY - 1) * CELL_SIZE + CELL_SIZE / 2 + (showCoordinates ? 25 : 0) + 40;

                const RADIUS = STONE_RADIUS;
                const FONT = FONT_SIZE;

                // Dynamic Flow Layout Calculation
                const boardDisplayWidth = (validMaxX - validMinX + 1) * CELL_SIZE;

                const footerBg = isMonochrome ? OFF_WHITE : '#DCB35C';

                // Pre-calculate positions using Flow Layout
                const itemsWithPos = hiddenMoves.reduce((acc, ref, i) => {
                    const leftW = 20 + (ref.left.length * 35);
                    const rightW = 80;
                    const itemWidth = leftW + rightW;

                    let nextX = 0;
                    let nextY = 0;

                    if (i === 0) {
                        nextX = 0;
                        nextY = 0;
                    } else {
                        const prev = acc[i - 1];
                        if (prev.x + prev.width + 20 + itemWidth > boardDisplayWidth) {
                            nextX = 0;
                            nextY = prev.y + 40;
                        } else {
                            // Gap of 20px
                            nextX = prev.x + prev.width + 20;
                            nextY = prev.y;
                        }
                    }

                    acc.push({ ...ref, x: nextX, y: nextY, width: itemWidth });
                    return acc;
                }, [] as any[]);

                return (
                    <g id="footer-group" transform={`translate(${startX}, ${startY})`} data-layout="flow">
                        {/* Background Mask: Hides grid lines if footer overlaps board area (in cropped view) */}
                        {/* We cover the area starting from the "spacing" gap down to the bottom */}
                        <rect
                            x={-2000}
                            y={-40} // Start from the top of the spacing gap
                            width={4000}
                            height={1000} // Sufficiently large
                            fill={footerBg}
                            stroke="none"
                        />

                        {itemsWithPos.map((item, i) => {
                            const { x, y } = item;
                            const rColor = item.right.color;

                            const leftGroup = item.left.map((stone: any, idx: number) => {
                                const stoneX = 20 + idx * 35;
                                return (
                                    <g key={`l-${idx}`}>
                                        <circle cx={stoneX} cy={0} r={RADIUS} fill={stone.color === 'BLACK' ? OFF_BLACK : OFF_WHITE} stroke={OFF_BLACK} strokeWidth={1} />
                                        <text x={stoneX} y={0} dy=".35em" textAnchor="middle" fill={stone.color === 'BLACK' ? OFF_WHITE : OFF_BLACK} fontSize={(stone.text && stone.text.length >= 3) ? CELL_SIZE * 0.45 : FONT} fontFamily="Arial, sans-serif" fontWeight="bold" style={{ WebkitFontSmoothing: 'none', fontSmooth: 'never' } as any}>{stone.text}</text>
                                    </g>
                                );
                            });

                            const leftWidthLength = item.left.length;
                            const rightStartX = 20 + (leftWidthLength * 35);

                            return (
                                <g key={`hm-${i}`} transform={`translate(${x}, ${y})`}>
                                    {leftGroup}

                                    {/* Bracket Open */}
                                    <text x={rightStartX} y={8} fontSize="20" fill={OFF_BLACK} fontFamily="sans-serif">[</text>

                                    {/* Right Stone (Label) */}
                                    <circle cx={rightStartX + 30} cy={0} r={RADIUS} fill={rColor === 'BLACK' ? OFF_BLACK : OFF_WHITE} stroke={OFF_BLACK} strokeWidth={1} />
                                    <text x={rightStartX + 30} y={0} dy=".35em" textAnchor="middle" fill={rColor === 'BLACK' ? OFF_WHITE : OFF_BLACK} fontSize={(item.right.text && item.right.text.length >= 3) ? CELL_SIZE * 0.45 : FONT} fontFamily="Arial, sans-serif" fontWeight="bold" style={{ WebkitFontSmoothing: 'none', fontSmooth: 'never' } as any}>{item.right.text}</text>

                                    {/* Bracket Close */}
                                    <text x={rightStartX + 60} y={8} fontSize="20" fill={OFF_BLACK} fontFamily="sans-serif">]</text>
                                </g>
                            );
                        })}
                    </g>
                );
            })()}


        </svg>
    );
});

GoBoard.displayName = 'GoBoard';
export default GoBoard;

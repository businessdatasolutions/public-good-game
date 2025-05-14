// sketches.js (voorheen p5_sketches.js)

// --- Sketch voor de STATISCHE matrix (Slide #/4 of waar je hem toont) ---
let pdMatrixStaticSketch = function(p_containerId) {
  return function(p) {
    let matrixWidth, matrixHeight, cellWidth, cellHeight, offsetX, offsetY;
    let topHeaderSpace = 70, sideLabelSpace = 110, choiceLabelOffset = 35;
    const payoffs = { 
      beken_beken: { p1: 5, p2: 5 }, beken_zwijg: { p1: 0, p2: 10 },
      zwijg_beken: { p1: 10, p2: 0 }, zwijg_zwijg: { p1: 1, p2: 1 }
    };
    const choices = ["Zwijgen", "Bekennen"];
    const player1Label = "Gevangene A", player2Label = "Gevangene B";

    function calculateDimensions() {
      let availableWidth = p.width - sideLabelSpace - 20; 
      let availableHeight = p.height - topHeaderSpace - 20;
      cellWidth = p.max(100, p.min(150, availableWidth / 2)); 
      cellHeight = p.max(70, p.min(100, availableHeight / 2));
      matrixWidth = 2 * cellWidth; matrixHeight = 2 * cellHeight;
      let totalMatrixVisualWidth = sideLabelSpace + matrixWidth; // Hernoemd om conflicten te voorkomen
      let totalMatrixVisualHeight = topHeaderSpace + matrixHeight; // Hernoemd
      offsetX = (p.width - totalMatrixVisualWidth) / 2 + sideLabelSpace; 
      offsetY = (p.height - totalMatrixVisualHeight) / 2 + topHeaderSpace;   
    }

    p.setup = function() {
      let container = document.getElementById(p_containerId);
      if (!container) { console.error("Static matrix container NOT FOUND:", p_containerId); return; }
      p.createCanvas(container.offsetWidth, container.offsetHeight);
      calculateDimensions(); 
      p.textFont(getComputedStyle(document.documentElement).getPropertyValue('--font-secondary').trim() || 'Arial');
      p.strokeWeight(2); 
      p.stroke(getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim() || '#A47E56');
      p.noLoop(); 
    };

    p.windowResized = function() { 
      let container = document.getElementById(p_containerId);
      if (!container) return;
      p.resizeCanvas(container.offsetWidth, container.offsetHeight);
      calculateDimensions();
      p.redraw(); 
    }

    p.draw = function() {
      p.background(getComputedStyle(document.documentElement).getPropertyValue('--main-bg-color').trim() || 240);
      let headingColor = getComputedStyle(document.documentElement).getPropertyValue('--heading-color').trim();
      let textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim();
      let p1PayoffColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-green').trim();
      let p2PayoffColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-secondary-green').trim();
      
      p.fill(headingColor); p.textSize(20); p.textAlign(p.CENTER, p.BOTTOM); 
      p.text(player2Label, offsetX + matrixWidth / 2, offsetY - choiceLabelOffset - 8); 
      p.textSize(18); p.fill(textColor); p.textAlign(p.CENTER, p.CENTER);
      for (let j = 0; j < 2; j++) p.text(choices[j], offsetX + cellWidth * (j + 0.5), offsetY - choiceLabelOffset / 2);
      
      p.fill(headingColor); p.textSize(20); p.textAlign(p.RIGHT, p.CENTER); 
      p.text(player1Label, offsetX - choiceLabelOffset - 8, offsetY + matrixHeight / 2);
      p.textSize(18); p.fill(textColor); p.textAlign(p.CENTER, p.CENTER); // Center align choices for P1 for better look next to rows
      for (let i = 0; i < 2; i++) p.text(choices[i], offsetX - sideLabelSpace/2 , offsetY + cellHeight * (i + 0.5)); // Adjusted X for P1 choices
      
      p.textAlign(p.CENTER, p.CENTER); // Reset

      let cellData = [[payoffs.zwijg_zwijg, payoffs.zwijg_beken], [payoffs.beken_zwijg, payoffs.beken_beken]];
      for (let i = 0; i < 2; i++) { 
        for (let j = 0; j < 2; j++) { 
          let x = offsetX + j * cellWidth; let y = offsetY + i * cellHeight;
          let currentOutcome = cellData[i][j];
          p.stroke(getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim());
          p.strokeWeight(2); // Zorg voor consistente lijndikte
          p.fill(252, 252, 248); p.rect(x, y, cellWidth, cellHeight);
          
          p.textSize(28); 
          p.noStroke(); // Geen stroke voor tekst
          p.fill(p1PayoffColor); p.text(currentOutcome.p1, x + cellWidth * 0.33, y + cellHeight / 2); 
          p.fill(p2PayoffColor); p.text(currentOutcome.p2, x + cellWidth * 0.67, y + cellHeight / 2); 
        }
      }
    };
  }; // Einde pdMatrixStaticSketch wrapper
};


// --- Sketch voor de DYNAMISCHE matrix met analyse ---
let pdMatrixAnalysisSketch = function(p_containerId) {
  return function(p) {
    let matrixWidth, matrixHeight, cellWidth, cellHeight, offsetX, offsetY;
    let topHeaderSpace = p.height * 0.18; 
    let sideLabelSpace = p.width * 0.22;  
    let choiceLabelOffset = p.min(p.height * 0.08, 30); 

    const payoffsData = { 
      beken_beken: { p1: 5, p2: 5 }, beken_zwijg: { p1: 0, p2: 10 },
      zwijg_beken: { p1: 10, p2: 0 }, zwijg_zwijg: { p1: 1, p2: 1 }
    };
    const choices = ["Zwijgen", "Bekennen"];
    const player1Label = "Gevangene A", player2Label = "Gevangene B";
    
    const highlightGoodColor = 'rgba(0, 100, 255, 0.9)'; 
    const highlightBadColor = 'rgba(255, 0, 0, 0.9)';   
    const normalPayoffColorP1 = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-green').trim();
    const normalPayoffColorP2 = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-secondary-green').trim();
    const columnHighlightColor = 'rgba(200, 200, 0, 0.15)'; 

    let currentAnalysisStep = null; 

    function calculateDimensions() {
      topHeaderSpace = p.height * 0.18;
      sideLabelSpace = p.width * 0.22;
      choiceLabelOffset = p.min(p.height * 1.08, 60);
      let coreMatrixAvailableWidth = p.width - sideLabelSpace - (p.width * 0.05); 
      let coreMatrixAvailableHeight = p.height - topHeaderSpace - (p.height * 0.05);
      let maxPossibleCellSize = p.min(coreMatrixAvailableWidth / 2, coreMatrixAvailableHeight / 2);
      cellWidth = p.max(60, p.min(120, maxPossibleCellSize)); 
      cellHeight = cellWidth * 0.75; 
      matrixWidth = 2 * cellWidth; 
      matrixHeight = 2 * cellHeight;
      offsetX = sideLabelSpace + (coreMatrixAvailableWidth - matrixWidth) / 2; 
      offsetY = topHeaderSpace + (coreMatrixAvailableHeight - matrixHeight) / 2;  
    }

    p.setup = function() { 
        let container = document.getElementById(p_containerId);
        if (!container) { console.error("Analysis matrix container NOT FOUND:", p_containerId); return; }
        p.createCanvas(container.offsetWidth, container.offsetHeight);
        calculateDimensions(); 
        p.textFont(getComputedStyle(document.documentElement).getPropertyValue('--font-secondary').trim() || 'Arial');
        // Default stroke for matrix cells set later
        p.noLoop();
    };
    p.windowResized = function() { 
        let container = document.getElementById(p_containerId);
        if (!container) return;
        p.resizeCanvas(container.offsetWidth, container.offsetHeight);
        calculateDimensions(); 
        p.redraw();
    };

    p.updateAnalysisStep = function(step) {
        currentAnalysisStep = step;
        p.loop(); 
    };

    // sketches.js -> pdMatrixAnalysisSketch -> draw()

    p.draw = function() {
      p.background(getComputedStyle(document.documentElement).getPropertyValue('--main-bg-color').trim() || 240);
      let headingColor = getComputedStyle(document.documentElement).getPropertyValue('--heading-color').trim();
      let textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim();
      let defaultMatrixStrokeColor = getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim() || '#A47E56';
      
      let playerLabelSize = cellHeight * 0.25;
      playerLabelSize = p.max(16, p.min(20, playerLabelSize)); 
      let choiceLabelSize = cellHeight * 0.22;
      choiceLabelSize = p.max(14, p.min(18, choiceLabelSize));
      let payoffTextSize = cellHeight * 0.35;
      payoffTextSize = p.max(20, p.min(30, payoffTextSize));

      // --- Speler Labels & Keuzes ---
      p.noStroke(); // Begin met geen stroke voor alle tekst-elementen
      p.fill(headingColor); p.textSize(playerLabelSize); p.textAlign(p.CENTER, p.BOTTOM); 
      p.text(player2Label, offsetX + matrixWidth / 2, offsetY - choiceLabelOffset * 0.6); 
      p.textSize(choiceLabelSize); p.fill(textColor); p.textAlign(p.CENTER, p.CENTER);
      for (let j = 0; j < 2; j++) {
        p.text(choices[j], offsetX + cellWidth * (j + 0.5), offsetY - choiceLabelOffset * 0.2);
      }
      p.fill(headingColor); p.textSize(playerLabelSize); p.textAlign(p.RIGHT, p.CENTER); 
      p.text(player1Label, offsetX - choiceLabelOffset * 0.6, offsetY + matrixHeight / 2);
      p.textSize(choiceLabelSize); p.fill(textColor); p.textAlign(p.CENTER, p.CENTER); 
      for (let i = 0; i < 2; i++) {
        p.text(choices[i], offsetX - sideLabelSpace/2 , offsetY + cellHeight * (i + 0.5));
      }
      p.textAlign(p.CENTER, p.CENTER); 
      // --- Einde Labels & Keuzes ---


      // --- Achtergrond Highlights (Kolom / Rij) ---
      p.noStroke(); // Zeker geen stroke voor deze achtergrond-rects
      if (currentAnalysisStep && currentAnalysisStep.startsWith("B_Zwijgt")) {
          p.fill(columnHighlightColor);
          p.rect(offsetX, offsetY, cellWidth, matrixHeight); 
      } else if (currentAnalysisStep && currentAnalysisStep.startsWith("B_Bekent")) {
          p.fill(columnHighlightColor);
          p.rect(offsetX + cellWidth, offsetY, cellWidth, matrixHeight); 
      }
      if (currentAnalysisStep === "A_Dominant") { 
          let y_dominant_row = offsetY + 1 * cellHeight; 
          p.fill(highlightGoodColor + '2A'); 
          p.rect(offsetX, y_dominant_row, matrixWidth, cellHeight); 
      }
      // --- Einde Achtergrond Highlights ---


      let cellPayoffsLookup = [ 
        [payoffsData.zwijg_zwijg, payoffsData.zwijg_beken],
        [payoffsData.beken_zwijg, payoffsData.beken_beken]
      ];

      // --- Loop door cellen om cellen, payoffs en cirkel-highlights te tekenen ---
      for (let i = 0; i < 2; i++) { 
        for (let j = 0; j < 2; j++) { 
          let x = offsetX + j * cellWidth; let y = offsetY + i * cellHeight;
          let currentOutcomeData = cellPayoffsLookup[i][j];
          
          // 1. Teken de cel zelf (achtergrond en rand)
          p.stroke(defaultMatrixStrokeColor); // Stroke AAN voor celrand
          p.strokeWeight(1.5); 
          p.fill(252, 252, 248); 
          p.rect(x, y, cellWidth, cellHeight);

          // 2. Bereid payoff kleuren en cirkel-highlight voor
          p.textSize(payoffTextSize); 
          let p1ColorToUse = normalPayoffColorP1;
          let p2ColorToUse = normalPayoffColorP2; 
          let circleRadius = cellHeight * 0.3; 
          let circleStrokeWeight = cellHeight * 0.05; 
          circleStrokeWeight = p.max(2.5, p.min(4, circleStrokeWeight)); 

          let shouldDrawP1Circle = false;
          let p1CircleColor = normalPayoffColorP1; 

          // Condities voor welke cirkel te tekenen
          if (currentAnalysisStep === "B_Zwijgt_A_Beken" && j === 0 && i === 1) { 
                shouldDrawP1Circle = true; p1CircleColor = highlightGoodColor;
          } else if (currentAnalysisStep === "B_Zwijgt_A_Zwijg" && j === 0 && i === 0) {
                shouldDrawP1Circle = true; p1CircleColor = highlightBadColor;
          } else if (currentAnalysisStep === "B_Bekent_A_Beken" && j === 1 && i === 1) {
                shouldDrawP1Circle = true; p1CircleColor = highlightGoodColor;
          } else if (currentAnalysisStep === "B_Bekent_A_Zwijg" && j === 1 && i === 0) {
                shouldDrawP1Circle = true; p1CircleColor = highlightBadColor;
          }
          
          // 3. Teken de payoffs (tekst)
          p.noStroke(); // Stroke UIT voor tekst
          p.fill(p1ColorToUse); p.text(currentOutcomeData.p1, x + cellWidth * 0.33, y + cellHeight / 2); 
          p.fill(p2ColorToUse); p.text(currentOutcomeData.p2, x + cellWidth * 0.67, y + cellHeight / 2); 

          // 4. Teken de cirkel-highlight (indien nodig) BOVENOP de payoffs
          if (shouldDrawP1Circle) {
              p.noFill(); // Geen vulling voor de cirkel zelf
              p.stroke(p1CircleColor); // Stroke AAN met de highlight kleur
              p.strokeWeight(circleStrokeWeight); 
              p.ellipse(x + cellWidth * 0.33, y + cellHeight / 2, circleRadius);
          }
          
          // 5. Teken de Nash Evenwicht cirkel (indien A_Dominant stap en juiste cel)
          if (currentAnalysisStep === "A_Dominant" && i === 1 && j === 1) { 
              p.noFill(); 
              p.stroke(200, 0, 0, 190); // Rode stroke voor Nash cirkel
              p.strokeWeight(p.max(3, cellHeight * 0.06));
              p.ellipse(x + cellWidth / 2, y + cellHeight / 2, cellWidth * 0.65, cellHeight * 0.65);
          }
        }
      }
      // --- Einde cellen loop ---

      if(currentAnalysisStep) p.noLoop(); 
    };
  }; // Einde pdMatrixAnalysisSketch wrapper
};
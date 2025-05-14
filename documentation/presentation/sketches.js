// p5_sketches.js

let pdMatrixSketch = function(p) {
  let matrixWidth, matrixHeight;
  let cellWidth, cellHeight;
  let totalMatrixVisualWidth, totalMatrixVisualHeight;
  let offsetX, offsetY; 

  let topHeaderSpace = 60;    // Ruimte voor "Gevangene B" en zijn keuzes
  let sideLabelSpace = 100;   // Ruimte voor "Gevangene A" en zijn keuzes (horizontaal)
  let choiceLabelOffset = 30; // Hoe ver de keuze labels van de matrix af staan

  let payoffs = { 
    beken_beken: { p1: 5, p2: 5 },
    beken_zwijg: { p1: 0, p2: 10 },
    zwijg_beken: { p1: 10, p2: 0 },
    zwijg_zwijg: { p1: 1, p2: 1 }
  };

  let choices = ["Zwijgen", "Bekennen"];
  let player1Label = "Gevangene A";
  let player2Label = "Gevangene B";

  let highlightCell = null; 
  let showDominant = false;
  let dominantOutcomeCoords = { r: 1, c: 1 }; 

  function calculateDimensions() {
    let availableWidth = p.width - sideLabelSpace - 20; 
    let availableHeight = p.height - topHeaderSpace - 20;

    cellWidth = p.max(80, p.min(130, availableWidth / 2)); // Min/Max celbreedte
    cellHeight = p.max(60, p.min(90, availableHeight / 2)); // Min/Max celhoogte

    matrixWidth = 2 * cellWidth;
    matrixHeight = 2 * cellHeight;

    totalMatrixVisualWidth = sideLabelSpace + matrixWidth;
    totalMatrixVisualHeight = topHeaderSpace + matrixHeight;

    offsetX = (p.width - totalMatrixVisualWidth) / 2 + sideLabelSpace; 
    offsetY = (p.height - totalMatrixVisualHeight) / 2 + topHeaderSpace;   
  }

  p.setup = function() {
    let container = document.getElementById('pdSketchContainer');
    p.createCanvas(container.offsetWidth, container.offsetHeight);
    calculateDimensions(); 
    p.textFont(getComputedStyle(document.documentElement).getPropertyValue('--font-secondary').trim() || 'Arial');
    p.strokeWeight(1.5); 
    p.stroke(getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim() || '#A47E56');
  };

  p.windowResized = function() { 
    let container = document.getElementById('pdSketchContainer');
    p.resizeCanvas(container.offsetWidth, container.offsetHeight);
    calculateDimensions();
  }

  p.draw = function() {
    p.background(
      getComputedStyle(document.documentElement).getPropertyValue('--main-bg-color').trim() || 240
    );
    
    let headingColor = getComputedStyle(document.documentElement).getPropertyValue('--heading-color').trim();
    let textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim();
    let p1PayoffColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-green').trim();
    let p2PayoffColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-secondary-green').trim();
    
    // Speler 2 Label (Bovenaan)
    p.fill(headingColor);
    p.textSize(18);
    p.textAlign(p.CENTER, p.BOTTOM); // Uitlijnen aan onderkant voor positionering boven keuzes
    p.text(player2Label, offsetX + matrixWidth / 2, offsetY - choiceLabelOffset - 5); 

    // Speler 2 Keuzes (Bovenaan matrix)
    p.textSize(16);
    p.fill(textColor);
    p.textAlign(p.CENTER, p.CENTER);
    for (let j = 0; j < 2; j++) {
      p.text(choices[j], offsetX + cellWidth * (j + 0.5), offsetY - choiceLabelOffset / 2);
    }

    // Speler 1 Label (Zijkant)
    p.fill(headingColor);
    p.textSize(18);
    p.textAlign(p.RIGHT, p.CENTER); // Rechts uitlijnen voor positionering naast keuzes
    p.text(player1Label, offsetX - choiceLabelOffset - 5, offsetY + matrixHeight / 2);

    // Speler 1 Keuzes (Zijkant matrix)
    p.textSize(16);
    p.fill(textColor);
    p.textAlign(p.RIGHT, p.CENTER); // Rechts uitlijnen
    for (let i = 0; i < 2; i++) {
      p.text(choices[i], offsetX - choiceLabelOffset / 2, offsetY + cellHeight * (i + 0.5));
    }

    // Reset textAlign voor de rest
    p.textAlign(p.CENTER, p.CENTER);

    // Matrix Cellen en Uitbetalingen
    let currentPayoffs;
    for (let i = 0; i < 2; i++) { 
      for (let j = 0; j < 2; j++) { 
        let x = offsetX + j * cellWidth;
        let y = offsetY + i * cellHeight;

        if (i === 0 && j === 0) currentPayoffs = payoffs.zwijg_zwijg; 
        else if (i === 0 && j === 1) currentPayoffs = payoffs.zwijg_beken; 
        else if (i === 1 && j === 0) currentPayoffs = payoffs.beken_zwijg; 
        else if (i === 1 && j === 1) currentPayoffs = payoffs.beken_beken; 
        
        p.stroke(getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim());
        
        if (highlightCell && highlightCell.row === i && highlightCell.col === j) {
          p.fill(getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim() + '40'); // Iets transparantere highlight
        } else {
          p.fill(252, 252, 248); // Zeer licht gebroken wit, bijna wit
        }
        p.rect(x, y, cellWidth, cellHeight);

        p.textSize(24); // Iets grotere uitbetalingen
        p.fill(p1PayoffColor);
        p.text(currentPayoffs.p1, x + cellWidth * 0.33, y + cellHeight / 2); 
        p.fill(p2PayoffColor);
        p.text(currentPayoffs.p2, x + cellWidth * 0.67, y + cellHeight / 2); 
      }
    }

    if (showDominant) {
        let eqX = offsetX + dominantOutcomeCoords.c * cellWidth;
        let eqY = offsetY + dominantOutcomeCoords.r * cellHeight;
        p.noFill();
        p.stroke(200, 0, 0, 180); // Iets transparantere rode lijn
        p.strokeWeight(3.5);
        p.ellipse(eqX + cellWidth / 2, eqY + cellHeight / 2, cellWidth * 0.65, cellHeight * 0.65); // Iets kleinere ellips
    }
  };

  p.customHighlight = function(row, col) { highlightCell = {row, col}; };
  p.clearHighlight = function() { highlightCell = null; };
  p.revealDominant = function() { showDominant = true; };
  p.hideDominant = function() { showDominant = false; };
};

// pdAnalysisSketch blijft ongewijzigd, tenzij je daar ook aanpassingen wilt
let pdAnalysisSketch = function(p) {
    // ... (vorige code voor pdAnalysisSketch) ...
    p.setup = function() {
        let container = document.getElementById('pdAnalysisSketchContainer');
        p.createCanvas(container.offsetWidth, container.offsetHeight);
        p.textAlign(p.CENTER, p.CENTER);
        p.textFont(getComputedStyle(document.documentElement).getPropertyValue('--font-secondary').trim() || 'Arial');
    };

    p.draw = function() {
        p.background(
          getComputedStyle(document.documentElement).getPropertyValue('--main-bg-color').trim() || 240
        );
        p.fill(getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim());
        p.textSize(16); // Standaardgrootte
        let currentFragment = typeof Reveal !== 'undefined' && Reveal.getIndices() ? Reveal.getIndices().f : -1;

        if (currentFragment >= 0) { 
             p.text("Gevangene A's perspectief:", p.width/2, 25); // Iets hoger
        }
        // Maak de tekst iets groter voor de analysepunten
        p.textSize(17); 
        if (currentFragment === 1 || currentFragment === 2) { 
            p.fill(getComputedStyle(document.documentElement).getPropertyValue('--accent-color-green').trim());
            p.text("Als B Zwijgt: Bekennen (0 jaar) is beter dan Zwijgen (1 jaar)", p.width/2, 60);
        }
        if (currentFragment === 3 || currentFragment === 4) { 
            p.fill(getComputedStyle(document.documentElement).getPropertyValue('--accent-color-secondary-green').trim());
            p.text("Als B Bekent: Bekennen (5 jaar) is beter dan Zwijgen (10 jaar)", p.width/2, 95);
        }
         if (currentFragment >= 5) { 
            p.fill(200,0,0); 
            p.textSize(19); // Iets groter voor de conclusie
            p.textStyle(p.BOLD);
            p.text("=> BEKENNEN is dominant voor A!", p.width/2, 135);
            p.textStyle(p.NORMAL); // Reset text style
        }
    };
};
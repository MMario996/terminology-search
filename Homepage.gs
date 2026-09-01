// ============================================================================
// WORKSPACE ADD-ON HOMEPAGE (Pflicht-Einstiegspunkt laut addOns-Manifest)
// Wird angezeigt, wenn der User das Add-on-Icon in der rechten Seitenleiste
// von Docs/Sheets/Slides anklickt, BEVOR er ein Dokument ?ffnet bzw. als
// Fallback-Ansicht. Das eigentliche Arbeiten l?uft weiterhin ?ber das Men?
// ?K?rcher TermCheck" (onOpen) und die Sidebars (showSidebar / showAuthorCheckSidebar).
// ============================================================================
function onHomepage(e) {
  var card = CardService.newCardBuilder();

  card.setHeader(CardService.newCardHeader()
    .setTitle('K?rcher TermCheck')
    .setSubtitle('Terminologie & Autoren-Check'));

  var section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph()
      .setText('?ffne das Men? <b>?K?rcher TermCheck"</b> oben im Dokument, um die Terminologie-Suche oder den Autoren-Check zu starten.'));

  section.addWidget(CardService.newTextButton()
    .setText('Terminologie-Suche ?ffnen')
    .setOnClickAction(CardService.newAction().setFunctionName('showSidebar')));

  section.addWidget(CardService.newTextButton()
    .setText('Autoren-Check ?ffnen')
    .setOnClickAction(CardService.newAction().setFunctionName('showAuthorCheckSidebar')));

  card.addSection(section);
  return card.build();
}
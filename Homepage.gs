// ============================================================================
// WORKSPACE ADD-ON HOMEPAGE (Default entry point)
// ============================================================================
function onHomepage(e) {
  var card = CardService.newCardBuilder();

  card.setHeader(CardService.newCardHeader()
    .setTitle('K?rcher TermCheck')
    .setSubtitle('Terminology Search & Authoring-Tool Check'));

  var section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph()
      .setText('Open the <b>Terminology Search</b> to browse for terminology or <b>Author Check</b> to check your document.'));

  section.addWidget(CardService.newTextButton()
    .setText('Open Terminology Search')
    .setOnClickAction(CardService.newAction().setFunctionName('showSidebar')));

  section.addWidget(CardService.newTextButton()
    .setText('Open Author Check')
    .setOnClickAction(CardService.newAction().setFunctionName('showAuthorCheckSidebar')));

  card.addSection(section);
  return card.build();
}
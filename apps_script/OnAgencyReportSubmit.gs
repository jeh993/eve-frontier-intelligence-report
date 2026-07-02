function onFormSubmit(e) {
  const response = {};
  const itemResponses = e.response.getItemResponses();

  itemResponses.forEach(function(itemResponse) {
    const question = itemResponse.getItem().getTitle();
    const answer = itemResponse.getResponse();

    response[question] = answer;
  });

  //"Reconnaissance Imagery"
  response.images = [];
  if (response["Screenshots"]){
    response["Screenshots"].forEach(image => {
      response.images.push(makePublic(image));
    });
  }

  //console.log(response);

  UrlFetchApp.fetch("https://eve-frontier-intelligence-report.onrender.com/webhook", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(response)
  });
}

function makePublic(fileId) {
  const file = DriveApp.getFileById(fileId);

  file.setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW
  );

  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}
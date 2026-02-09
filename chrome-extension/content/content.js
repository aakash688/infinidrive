/**
 * InfiniDrive Chrome Extension Content Script
 * Minimal - only loaded if needed for page interaction
 */

// Listen for messages from background service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageInfo') {
    sendResponse({
      title: document.title,
      url: window.location.href,
    });
  }
  return true;
});

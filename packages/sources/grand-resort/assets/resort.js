// Grand Azure Resort - Interactive Client Logic
document.addEventListener('DOMContentLoaded', function() {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  
  const inEl = document.getElementById('homeCheckIn');
  const outEl = document.getElementById('homeCheckOut');
  if (inEl && !inEl.value) inEl.value = today;
  if (outEl && !outEl.value) outEl.value = tomorrow;

  const mIn = document.getElementById('bookCheckIn');
  const mOut = document.getElementById('bookCheckOut');
  if (mIn && !mIn.value) mIn.value = today;
  if (mOut && !mOut.value) mOut.value = tomorrow;
});

function openBookingModal(roomName, pricePerNight) {
  const modal = document.getElementById('bookingModal');
  const title = document.getElementById('modalRoomTitle');
  const price = document.getElementById('modalRoomPrice');
  const inpRoom = document.getElementById('bookRoomName');
  const inpPrice = document.getElementById('bookPrice');
  const totalPrice = document.getElementById('modalTotalPrice');

  if (title) title.innerText = roomName;
  if (price) price.innerText = '¥' + pricePerNight + ' / 每晚 (起)';
  if (inpRoom) inpRoom.value = roomName;
  if (inpPrice) inpPrice.value = pricePerNight;
  if (totalPrice) totalPrice.innerText = '¥' + pricePerNight;

  document.getElementById('bookingForm').style.display = 'block';
  document.getElementById('bookingSuccessBox').style.display = 'none';

  if (modal) modal.style.display = 'flex';
}

function closeBookingModal() {
  const modal = document.getElementById('bookingModal');
  if (modal) modal.style.display = 'none';
}

function doSearchRooms() {
  const cat = document.getElementById('homeCategory')?.value || '';
  window.location.href = window.location.pathname.replace(/\/$/, '') + '/rooms';
}

function handleBookingSubmit(event) {
  event.preventDefault();
  const roomName = document.getElementById('bookRoomName')?.value || '海景私享套房';
  const price = document.getElementById('bookPrice')?.value || '3580';
  const guestName = document.getElementById('bookGuestName')?.value || 'Guest';

  // Generate reference number
  const ref = 'BK' + Date.now().toString().slice(-8);

  // Show success in UI
  document.getElementById('bookingForm').style.display = 'none';
  const successBox = document.getElementById('bookingSuccessBox');
  const refCode = document.getElementById('bookingRefCode');
  if (refCode) refCode.innerText = '预订流水号: ' + ref;
  if (successBox) successBox.style.display = 'block';
}

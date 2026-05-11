document.addEventListener('DOMContentLoaded', () => {
  const card = document.querySelector('.tilt-card');
  
  if (card) {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const rotateX = ((y - centerY) / centerY) * -15; 
      const rotateY = ((x - centerX) / centerX) * 15;
      
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });
    
    card.addEventListener('mouseleave', () => {
      card.style.transform = `perspective(1000px) rotateX(0) rotateY(0)`;
      card.style.transition = 'transform 0.5s ease-out';
    });
    
    card.addEventListener('mouseenter', () => {
      card.style.transition = 'none';
    });
  }
});

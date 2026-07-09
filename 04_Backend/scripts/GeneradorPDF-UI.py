import sys
from PyQt5.QtWidgets import QApplication, QMainWindow, QLabel, QPushButton, QFileDialog, QGraphicsView, QGraphicsScene, QGraphicsPixmapItem, QGraphicsRectItem, QGraphicsTextItem
from PyQt5.QtGui import QPixmap, QImage, QPainter
from PyQt5.QtCore import Qt
from reportlab.pdfgen import canvas

class PDFGeneratorApp(QMainWindow):
    def __init__(self):
        super().__init__()

        self.initUI()

    def initUI(self):
        self.setGeometry(100, 100, 800, 600)
        self.setWindowTitle('PDF Generator App')

        # Crear la escena y la vista gráfica
        self.scene = QGraphicsScene(self)
        self.view = QGraphicsView(self.scene)
        self.setCentralWidget(self.view)

        # Botón para agregar imagen
        self.addButton = QPushButton('Agregar Imagen', self)
        self.addButton.clicked.connect(self.addImage)
        self.addButton.setGeometry(10, 10, 150, 30)

        # Botón para guardar como PDF
        self.saveButton = QPushButton('Guardar como PDF', self)
        self.saveButton.clicked.connect(self.saveAsPDF)
        self.saveButton.setGeometry(170, 10, 150, 30)

    def addImage(self):
        options = QFileDialog.Options()
        options |= QFileDialog.ReadOnly
        filePath, _ = QFileDialog.getOpenFileName(self, "Seleccionar Imagen", "", "Imágenes (*.png *.jpg *.bmp *.gif);;Todos los archivos (*)", options=options)

        if filePath:
            pixmap = QPixmap(filePath)
            item = QGraphicsPixmapItem(pixmap)
            self.scene.addItem(item)

    def saveAsPDF(self):
        options = QFileDialog.Options()
        options |= QFileDialog.DontUseNativeDialog
        filePath, _ = QFileDialog.getSaveFileName(self, "Guardar como PDF", "", "Archivos PDF (*.pdf);;Todos los archivos (*)", options=options)

        if filePath:
            printer = QPainter()
            printer.begin(self)
            pdf = canvas.Canvas(filePath)

            for item in self.scene.items():
                if isinstance(item, QGraphicsPixmapItem):
                    img = QImage(item.pixmap())
                    pdf.drawInlineImage(img, item.pos().x(), item.pos().y(), width=img.width(), height=img.height())

            pdf.save()
            printer.end()

def main():
    app = QApplication(sys.argv)
    window = PDFGeneratorApp()
    window.show()
    sys.exit(app.exec_())

if __name__ == '__main__':
    main()